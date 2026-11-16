import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { Prisma, StageStatus } from '@moderation/database';
import { evaluateRules, getRedisConnectionOptions, MODERATION_QUEUE_NAME, ModerationQueuePayload } from '@moderation/shared';
import { MetadataScanner } from './metadata-scanner';
import { DeepAnalysisResult, DeepAnalyzer } from './deep-analyzer';
import { OpenRouterClient, OpenRouterResult } from './openrouter.client';
import { calculateRisk } from './risk-engine';
import { WorkerPrismaService } from './worker-prisma.service';
import { ActiveModel, WorkerConfigurationService } from './worker-configuration.service';

const NEMOTRON_MODEL = process.env.OPENROUTER_NEMOTRON_MODEL ?? 'nvidia/nemotron-3.5-content-safety';
const QWEN_MODEL = process.env.OPENROUTER_QWEN_MODEL ?? 'qwen/qwen3.6-flash';
const QWEN_SCENE_PROMPT = '[stage:initial_scene] Analyze visible people, human-like characters (including anime and other illustrated characters), body parts, interior scene types, and objects. Treat an identified humanoid, anthropomorphic, or illustrated person as present and include it in the count. Use NO_HUMANS only when no person-like character or human body part is visible. Do not infer age as a fact. Return only the requested JSON.';
const QWEN_SCHEMA: Record<string, unknown> = {
  name: 'image_scene_classification', strict: true,
  schema: { type: 'object', additionalProperties: false, required: ['humans', 'scene', 'objects'], properties: {
    humans: { type: 'object', additionalProperties: false, required: ['present', 'count', 'categories'], properties: {
      present: { type: 'boolean' }, count: { type: 'integer', minimum: 0 }, categories: { type: 'array', items: { type: 'string', enum: ['REAL_PERSON', 'PERSON_IN_ARTWORK', 'HUMANOID_CHARACTER', 'ANTHROPOMORPHIC_CHARACTER', 'HUMAN_BODY_PART', 'UNCERTAIN_HUMAN', 'NO_HUMANS'] } },
    } },
    scene: { type: 'object', additionalProperties: false, required: ['categories'], properties: { categories: { type: 'array', items: { type: 'string', enum: ['INTERIOR_SCENE', 'FURNITURE', 'WALL_ART', 'DECOR', 'TEXTURE', 'AR_OBJECT', 'OTHER', 'UNKNOWN'] } } } },
    objects: { type: 'array', items: { type: 'string' } },
  } },
};

@Injectable()
class ModerationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ModerationWorker.name);
  private readonly bucket = process.env.MINIO_BUCKET ?? 'moderation-private';
  private readonly storage = new S3Client({
    endpoint: `${process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http'}://${process.env.MINIO_ENDPOINT ?? 'minio'}:${process.env.MINIO_PORT ?? '9000'}`,
    region: 'us-east-1', forcePathStyle: true,
    credentials: { accessKeyId: process.env.MINIO_ROOT_USER ?? '', secretAccessKey: process.env.MINIO_ROOT_PASSWORD ?? '' },
  });
  private worker: Worker<ModerationQueuePayload> | undefined;

  constructor(private readonly prisma: WorkerPrismaService, private readonly metadataScanner: MetadataScanner, private readonly openRouter: OpenRouterClient, private readonly deepAnalyzer: DeepAnalyzer, private readonly config: WorkerConfigurationService) {}

  onModuleInit(): void {
    const parsedConcurrency = Number(process.env.WORKER_CONCURRENCY ?? 4);
    const concurrency = Number.isSafeInteger(parsedConcurrency) && parsedConcurrency > 0 ? parsedConcurrency : 4;
    this.worker = new Worker<ModerationQueuePayload>(MODERATION_QUEUE_NAME,
      async (job: Job<ModerationQueuePayload>) => this.processJob(job),
      { connection: getRedisConnectionOptions(process.env.REDIS_URL ?? 'redis://redis:6379'), concurrency,
        maxStalledCount: positiveIntegerFromEnv('QUEUE_MAX_STALLED_COUNT', 2),
        stalledInterval: positiveIntegerFromEnv('QUEUE_STALLED_INTERVAL_MS', 30_000) });
    this.worker.on('active', (job) => this.logger.log(`Moderation job ${job.data.moderationJobId} is being processed (attempt ${job.attemptsMade + 1}).`));
    this.worker.on('completed', (job) => this.logger.log(`Moderation job ${job.data.moderationJobId} completed.`));
    this.worker.on('failed', (job, error) => {
      if (!job) {
        this.logger.error(`Queue task failed without job details: ${errorMessage(error)}`);
        return;
      }
      const isFinalAttempt = job.attemptsMade >= Number(job.opts.attempts ?? 1);
      const message = `Queue task ${isFinalAttempt ? 'failed permanently' : 'will retry'} for ${job.data.moderationJobId} (attempt ${job.attemptsMade}/${job.opts.attempts ?? 1}): ${errorMessage(error)}`;
      if (isFinalAttempt) {
        this.logger.error(message);
        void this.markFailed(job.data.moderationJobId).catch((failure: unknown) => this.logger.error(`Could not mark ${job.data.moderationJobId} failed: ${errorMessage(failure)}`));
      } else this.logger.warn(message);
    });
    this.worker.on('error', (error) => this.logger.error(`Queue worker error: ${error.message}`));
    this.worker.on('stalled', (jobId) => this.logger.warn(`Queue job ${jobId} stalled; BullMQ will recover it.`));
    this.worker.on('ready', () => this.logger.log('Moderation queue worker is ready.'));
    this.worker.on('closed', () => this.logger.warn('Moderation queue worker closed.'));
    this.logger.log(`Moderation queue consumer started with concurrency ${concurrency}.`);
  }

  private async processJob(queueJob: Job<ModerationQueuePayload>): Promise<void> {
    const job = await this.prisma.moderationJob.findUnique({ where: { id: queueJob.data.moderationJobId }, include: { imageAsset: true } });
    if (!job || job.status === 'COMPLETED') return;
    try {
      await this.prisma.moderationJob.updateMany({ where: { id: job.id, status: { in: ['QUEUED', 'PROCESSING'] } }, data: { status: 'PROCESSING', startedAt: new Date(queueJob.processedOn ?? Date.now()), completedAt: null, errorCode: null } });
      const pipeline = await this.config.pinPipeline(job.id, job.pipeline, job.pipelineVersionId);
      const object = await this.storage.send(new GetObjectCommand({ Bucket: this.bucket, Key: job.imageAsset.objectKey }));
      if (!object.Body) throw new Error('Image object was empty.');
      const image = Buffer.from(await object.Body.transformToByteArray());
      if (BigInt(image.length) !== job.imageAsset.sizeBytes) throw new Error('Stored image size does not match its database record.');
      const metadata = await this.runStage(job.id, 'metadata_analysis', null, () => this.metadataScanner.scan(image, job.imageAsset.originalName));
      const safetyModel = await this.config.model('nsfw_detection', NEMOTRON_MODEL);
      const safetyPrompt = await this.config.prompt('initial_nsfw', 'Classify the image for explicit nudity, sexual content, sexualized imagery, and other unsafe content. Reply using exactly: Safety: safe|unsafe; Categories: comma-separated labels or none. Do not infer certainty beyond what is visible.');
      const safety = await this.runModelStage(job.id, 'nsfw_detection', safetyModel, safetyPrompt.content, safetyPrompt.id, image, job.imageAsset.mimeType);
      const safetyResult = await this.runStage(job.id, 'nsfw_response_validation', safetyModel.modelId, async () => parseSafety(safety.content));
      let scene: ReturnType<typeof parseScene> | null = null;
      let sceneModelId = QWEN_MODEL;
      if (!safetyResult.criticalReview) {
        const sceneModel = await this.config.model('initial_scene', QWEN_MODEL);
        sceneModelId = sceneModel.modelId;
        const scenePrompt = await this.config.prompt('initial_scene', QWEN_SCENE_PROMPT);
        const sceneCall = await this.runModelStage(job.id, 'people_object_detection', sceneModel, scenePrompt.content, scenePrompt.id, image, job.imageAsset.mimeType, QWEN_SCHEMA);
        scene = await this.runStage(job.id, 'people_response_validation', sceneModel.modelId, async () => parseScene(sceneCall.content));
      }
      const rules = await this.config.activeRules();
      const initialRuleOutcome = evaluateRules(rules, { nsfwUnsafe: safetyResult.unsafe, peoplePresent: scene?.humans.present ?? false, criticalReview: safetyResult.criticalReview, suspiciousText: false, sexualizedContext: false, sexualizedInteraction: false }, job.applicationId);
      const suspiciousSexualObject = hasPotentialSexualObject(scene?.objects ?? []);
      const deep: DeepAnalysisResult | null = scene && pipeline.deepAnalysis ? await this.deepAnalyzer.analyze(job.id, image, job.imageAsset.mimeType, {
        safety: safetyResult,
        scene,
        metadata: { suspiciousKeywords: metadata.suspiciousKeywords, sourceUrls: metadata.sourceUrls },
        width: job.imageAsset.width,
        height: job.imageAsset.height,
        forceDeep: initialRuleOutcome.triggerDeepAnalysis || suspiciousSexualObject,
        maxImageCrops: pipeline.maxImageCrops,
      }) : null;
      const cropSkippedForSmallImage = pipeline.maxImageCrops > 0 && (job.imageAsset.width < 512 || job.imageAsset.height < 512);
      const primaryUnsafeOverruled = canOverridePrimaryUnsafe(safetyResult, deep, scene, cropSkippedForSmallImage);
      const riskInput = {
        nsfwUnsafe: safetyResult.unsafe, primaryUnsafeOverruled, sexualSignalCount: metadata.suspiciousKeywords.length,
        peoplePresent: scene?.humans.present ?? false, humanBodyPartPresent: scene?.humans.categories.includes('HUMAN_BODY_PART') ?? false,
        interiorContextPresent: scene?.scene.categories.includes('INTERIOR_SCENE') === true && scene.scene.categories.includes('FURNITURE'),
        suspiciousSexualObject,
        criticalReview: safetyResult.criticalReview,
        sexualizedRelationship: deep?.relationships?.sexualized_interaction,
        sexualizedComposition: deep?.composition?.sexualized_focus,
        sexualizedContext: deep?.context?.sexual_context,
        suspiciousText: deep?.ocr?.suspicious_text,
        cropUnsafe: deep?.crops.regions?.some((region) => region.sexual_content),
        arbitratorRestricted: deep?.arbitration?.recommendation === 'RESTRICT',
        confirmedSexualContent: deep?.crops.regions?.some((region) => region.sexual_content) === true
          && deep.composition?.sexualized_focus === true
          && deep.context?.sexual_context === true
          && deep.arbitration?.recommendation === 'RESTRICT',
        fetishContentDetected: deep?.context?.fetish_content === true,
      };
      const preliminaryRisk = calculateRisk(riskInput);
      const finalRuleOutcome = evaluateRules(rules, { nsfwUnsafe: safetyResult.unsafe, peoplePresent: scene?.humans.present ?? false, criticalReview: safetyResult.criticalReview, suspiciousText: deep?.ocr?.suspicious_text ?? false, sexualizedContext: deep?.context?.sexual_context ?? false, sexualizedInteraction: deep?.relationships?.sexualized_interaction ?? false, nsfwRiskScore: preliminaryRisk.nsfwRiskScore, domainMismatchScore: preliminaryRisk.domainMismatchScore, sexualSignalCount: metadata.suspiciousKeywords.length, confidence: preliminaryRisk.confidence }, job.applicationId);
      const risk = calculateRisk({ ...riskInput, forceReview: initialRuleOutcome.requireReview || finalRuleOutcome.requireReview });
      const payload = { metadata_analysis: metadata, nsfw_detection: { model: safetyModel.modelId, ...safetyResult }, people_object_detection: scene ? { model: sceneModelId, ...scene } : { status: 'SKIPPED_CRITICAL_REVIEW' }, deep_analysis: deep, matched_rules: [...new Set([...initialRuleOutcome.matchedRuleKeys, ...finalRuleOutcome.matchedRuleKeys])], risk };
      await this.prisma.$transaction(async (tx) => {
        await tx.moderationResult.create({ data: {
          jobId: job.id, nsfwRiskScore: risk.nsfwRiskScore, domainMismatchScore: risk.domainMismatchScore,
          confidence: risk.confidence, decision: risk.decision, criticalFlags: risk.criticalFlags, reasons: risk.reasons, payload: toJsonObject(payload),
        } });
        await tx.moderationJob.update({ where: { id: job.id }, data: { status: 'COMPLETED', completedAt: new Date(), errorCode: null } });
      });
    } catch (error) {
      await this.recordStageFailure(job.id, error);
      throw error;
    }
  }

  private async runStage<T>(jobId: string, stageType: string, modelId: string | null, operation: () => Promise<T>): Promise<T> {
    const startedAt = new Date();
    const stage = await this.prisma.stageExecution.create({ data: { jobId, stageType, modelId, status: StageStatus.PROCESSING } });
    try {
      const result = await operation();
      await this.prisma.stageExecution.update({ where: { id: stage.id }, data: { status: StageStatus.COMPLETED, completedAt: new Date(), durationMs: Date.now() - startedAt.getTime(), normalizedOutput: JSON.parse(JSON.stringify(result)) } });
      return result;
    } catch (error) {
      await this.prisma.stageExecution.update({ where: { id: stage.id }, data: { status: StageStatus.FAILED, completedAt: new Date(), durationMs: Date.now() - startedAt.getTime(), error: errorMessage(error).slice(0, 2000) } });
      throw error;
    }
  }

  private async runModelStage(jobId: string, stageType: string, model: ActiveModel, prompt: string, promptVersionId: string | undefined, image: Buffer, mimeType: string, schema?: Record<string, unknown>): Promise<OpenRouterResult> {
    const modelId = model.modelId;
    const startedAt = new Date();
    const stage = await this.prisma.stageExecution.create({ data: { jobId, stageType, modelId, promptVersionId, status: StageStatus.PROCESSING } });
    try {
      const response = await this.openRouter.analyze(modelId, prompt, image, mimeType, schema, model);
      const resolvedModelId = response.modelId ?? modelId;
      await this.prisma.$transaction([
        this.prisma.modelInvocation.create({ data: { jobId, stageExecutionId: stage.id, modelId: resolvedModelId, provider: response.provider, requestId: response.requestId, inputTokens: response.inputTokens, outputTokens: response.outputTokens, costUsd: response.costUsd ?? undefined, latencyMs: response.latencyMs, status: StageStatus.COMPLETED } }),
        this.prisma.stageExecution.update({ where: { id: stage.id }, data: { modelId: resolvedModelId, status: StageStatus.COMPLETED, completedAt: new Date(), durationMs: Date.now() - startedAt.getTime(), normalizedOutput: { content: response.content } } }),
      ]);
      return response;
    } catch (error) {
      await this.prisma.$transaction([
        this.prisma.modelInvocation.create({ data: { jobId, stageExecutionId: stage.id, modelId, latencyMs: Date.now() - startedAt.getTime(), status: StageStatus.FAILED } }),
        this.prisma.stageExecution.update({ where: { id: stage.id }, data: { status: StageStatus.FAILED, completedAt: new Date(), durationMs: Date.now() - startedAt.getTime(), error: errorMessage(error).slice(0, 2000) } }),
      ]);
      throw error;
    }
  }

  private async recordStageFailure(jobId: string, error: unknown): Promise<void> {
    this.logger.warn(`Moderation attempt failed for ${jobId}: ${errorMessage(error)}`);
  }

  private async markFailed(id: string): Promise<void> {
    try {
      await this.prisma.moderationJob.updateMany({ where: { id, status: { in: ['QUEUED', 'PROCESSING'] } }, data: { status: 'FAILED', errorCode: 'MODERATION_PROCESSING_FAILED', completedAt: new Date() } });
    } catch (error) {
      this.logger.error(`Could not persist failure for ${id}: ${errorMessage(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> { await this.worker?.close(); this.storage.destroy(); }
}

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

@Module({ providers: [WorkerPrismaService, MetadataScanner, OpenRouterClient, WorkerConfigurationService, DeepAnalyzer, ModerationWorker] })
export class WorkerModule {}

export function parseSafety(value: string): { unsafe: boolean; categories: string[]; criticalReview: boolean } {
  const safety = value.match(/^\s*(?:user\s+safety|safety)\s*:\s*(safe|unsafe)\b/imu);
  const categories = value.match(/^\s*(?:safety\s+)?categories\s*:\s*([^\r\n]+)/imu);
  if (!safety) throw new Error('Nemotron response did not include a valid User Safety label.');
  const labels = categories?.[1].trim().toLowerCase() ?? 'none';
  const categoryList = labels === 'none' ? [] : labels.split(/[,;|]/u).map((category) => category.trim()).filter(Boolean);
  if (categoryList.length === 0 && labels !== 'none') throw new Error('Nemotron returned an invalid Categories label.');
  const criticalReview = categoryList.some((category) => /\b(?:csam|child sexual|sexual.{0,20}(?:minor|child)|(?:minor|child).{0,20}sexual|sexual exploitation of children)\b/iu.test(category));
  return { unsafe: safety[1].toLowerCase() === 'unsafe', categories: categoryList, criticalReview };
}

export function parseScene(value: string): { humans: { present: boolean; count: number; categories: string[] }; scene: { categories: string[] }; objects: string[] } {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error('Qwen returned malformed JSON.'); }
  if (Array.isArray(parsed) && parsed.length === 1) parsed = parsed[0];
  if (!isRecord(parsed) || !isRecord(parsed.humans) || !isRecord(parsed.scene) || typeof parsed.humans.present !== 'boolean' || !Number.isSafeInteger(parsed.humans.count) || !isStringArray(parsed.humans.categories) || !isStringArray(parsed.scene.categories) || !isStringArray(parsed.objects)) {
    throw new Error('Qwen response is missing required people or scene fields.');
  }
  const count = parsed.humans.count as number;
  if (count < 0) throw new Error('Qwen response has an invalid human count.');
  const humanCategories = ['REAL_PERSON', 'PERSON_IN_ARTWORK', 'HUMANOID_CHARACTER', 'ANTHROPOMORPHIC_CHARACTER', 'HUMAN_BODY_PART', 'UNCERTAIN_HUMAN', 'NO_HUMANS'];
  const sceneCategories = ['INTERIOR_SCENE', 'FURNITURE', 'WALL_ART', 'DECOR', 'TEXTURE', 'AR_OBJECT', 'OTHER', 'UNKNOWN'];
  if (parsed.humans.categories.some((category) => !humanCategories.includes(category)) || parsed.scene.categories.some((category) => !sceneCategories.includes(category)) || parsed.objects.length > 100 || parsed.objects.some((object) => object.length > 200)) {
    throw new Error('Qwen response contains unsupported or oversized scene labels.');
  }
  const personCategories = ['REAL_PERSON', 'PERSON_IN_ARTWORK', 'HUMANOID_CHARACTER', 'ANTHROPOMORPHIC_CHARACTER', 'UNCERTAIN_HUMAN'];
  const hasPersonCategory = parsed.humans.categories.some((category) => personCategories.includes(category));
  const present = parsed.humans.present || count > 0 || hasPersonCategory;
  parsed.humans.present = present;
  parsed.humans.count = Math.max(count, present ? 1 : 0);
  if (present) parsed.humans.categories = parsed.humans.categories.filter((category) => category !== 'NO_HUMANS');
  return parsed as { humans: { present: boolean; count: number; categories: string[] }; scene: { categories: string[] }; objects: string[] };
}

export function canOverridePrimaryUnsafe(
  safety: { unsafe: boolean; categories: string[]; criticalReview: boolean },
  deep: DeepAnalysisResult | null,
  scene: ReturnType<typeof parseScene> | null,
  cropSkippedForSmallImage: boolean,
): boolean {
  if (!safety.unsafe || safety.categories.length > 0 || safety.criticalReview || !deep || !scene) return false;
  const completedSafeCrops = deep.crops.status === 'COMPLETED'
    && (deep.crops.regions?.length ?? 0) > 0
    && deep.crops.regions?.every((region) => !region.sexual_content) === true;
  const decomposition = deep.sceneDecomposition;
  const decompositionPeople = decomposition && Array.isArray(decomposition.persons) ? decomposition.persons : null;
  const sceneObjects = [
    ...scene.objects,
    ...(decomposition && Array.isArray(decomposition.objects) ? decomposition.objects.filter((object): object is string => typeof object === 'string') : []),
  ];
  const safeObjectOnlyScene = cropSkippedForSmallImage
    && deep.crops.status === 'SKIPPED_IMAGE_TOO_SMALL_OR_DISABLED'
    && !scene.humans.present
    && scene.humans.count === 0
    && !scene.humans.categories.includes('HUMAN_BODY_PART')
    && !scene.humans.categories.includes('UNCERTAIN_HUMAN')
    && scene.scene.categories.includes('INTERIOR_SCENE')
    && scene.scene.categories.includes('FURNITURE')
    && !hasPotentialSexualObject(sceneObjects)
    && decompositionPeople?.length === 0;
  return safety.unsafe
    && deep?.context?.classification === 'NON_SEXUAL'
    && !deep.context.sexual_context
    && !deep.context.fetish_content
    && deep.composition?.sexualized_focus === false
    && deep.relationships?.sexualized_interaction === false
    && (completedSafeCrops || safeObjectOnlyScene)
    && deep.ocr?.suspicious_text === false
    && deep.arbitration?.recommendation === 'ALLOW';
}

export function hasPotentialSexualObject(objects: string[]): boolean {
  const pattern = /\b(?:sex[\s-]?toys?|vibrators?|dildos?|masturbators?|erotic\s+toys?|sexual\s+toys?)\b|(?:секс[\s-]?игрушк\p{L}*|вибратор\p{L}*|фаллоимитатор\p{L}*|мастурбатор\p{L}*|дилдо\p{L}*|эротическ\p{L}*\s+(?:игрушк\p{L}*|девайс\p{L}*)|вагинальн\p{L}*\s+стимулятор\p{L}*)/iu;
  return objects.some((object) => pattern.test(object));
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isStringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === 'string'); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Unknown error'; }

function toJsonObject(value: object): Prisma.InputJsonObject {
  const result: Record<string, Prisma.InputJsonValue | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') result[key] = item;
    else if (Array.isArray(item)) result[key] = item.map((entry) => toJsonValue(entry));
    else if (typeof item === 'object') result[key] = toJsonObject(item);
    else throw new Error(`Unsupported JSON value for key ${key}.`);
  }
  return result;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue | null {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((entry) => toJsonValue(entry));
  if (typeof value === 'object') return toJsonObject(value);
  throw new Error('Unsupported value in moderation result JSON.');
}
