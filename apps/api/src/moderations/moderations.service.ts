import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@moderation/database';
import { PrismaService } from '../database/prisma.service';
import { QueueProducerService } from '../queue/queue-producer.service';
import { StorageService } from '../storage/storage.service';
import { ImageValidationService } from './image-validation.service';

export interface CreateModerationInput {
  applicationId: string;
  pipeline: string;
  context: Prisma.InputJsonObject;
  idempotencyKey?: string;
  file: Express.Multer.File;
}

export type AdminRole = 'ADMIN' | 'SPECIALIST';
export interface ModerationListFilters { page: number; pageSize: number; search?: string; applicationId?: string; pipeline?: string; status?: string; decision?: string; from?: Date; to?: Date }
export interface ReviewDecisionInput { action: 'APPROVED' | 'REJECTED'; reason?: string; comment?: string; reviewVersion: number }

const MAX_UPLOAD_BYTES = positiveIntegerFromEnv('MAX_UPLOAD_BYTES', 10 * 1024 * 1024);
const MAX_IMAGE_PIXELS = positiveIntegerFromEnv('MAX_IMAGE_PIXELS', 40_000_000);
const MAX_IMAGE_SIDE = positiveIntegerFromEnv('MAX_IMAGE_SIDE', 12_000);

@Injectable()
export class ModerationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queue: QueueProducerService,
    private readonly imageValidation: ImageValidationService,
  ) {}

  async create(input: CreateModerationInput): Promise<{ job_id: string; status: string }> {
    const image = await this.imageValidation.validate(
      input.file.buffer,
      input.file.mimetype,
      MAX_UPLOAD_BYTES,
      MAX_IMAGE_PIXELS,
      MAX_IMAGE_SIDE,
    );
    const asset = await this.getOrCreateAsset(input.file, image);

    if (input.idempotencyKey) {
      const previous = await this.prisma.moderationJob.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (previous) return this.reuseIdempotentJob(previous, asset.id, input.applicationId);
    }

    let job;
    try {
      job = await this.prisma.moderationJob.create({
        data: {
          applicationId: input.applicationId,
          imageAssetId: asset.id,
          pipeline: input.pipeline,
          context: input.context,
          idempotencyKey: input.idempotencyKey,
        },
      });
    } catch (error) {
      if (input.idempotencyKey && isUniqueConstraintError(error)) {
        const previous = await this.prisma.moderationJob.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (previous) return this.reuseIdempotentJob(previous, asset.id, input.applicationId);
      }
      throw error;
    }

    try {
      await this.queue.enqueue({ moderationJobId: job.id, imageAssetId: asset.id });
    } catch {
      await this.prisma.moderationJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', errorCode: 'QUEUE_UNAVAILABLE', completedAt: new Date() },
      });
      throw new ServiceUnavailableException({
        message: 'The moderation task could not be placed in the processing queue.',
        job_id: job.id,
        status: 'failed',
      });
    }

    return { job_id: job.id, status: 'queued' };
  }

  async getStatus(id: string): Promise<{
    job_id: string;
    status: string;
    decision: string | null;
    result: { nsfw_risk_score: number; domain_mismatch_score: number; confidence: number | null; reasons: unknown; critical_flags: unknown; details: unknown } | null;
    error_code: string | null;
    created_at: Date;
    image: { mime_type: string; size_bytes: number; width: number; height: number };
  }> {
    const job = await this.prisma.moderationJob.findUnique({
      where: { id },
      include: { imageAsset: true, results: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!job) throw new NotFoundException('Moderation job was not found.');

    return {
      job_id: job.id,
      status: job.status.toLowerCase(),
      decision: job.effectiveDecision ?? job.results[0]?.decision ?? null,
      result: job.results[0] ? {
        nsfw_risk_score: job.results[0].nsfwRiskScore,
        domain_mismatch_score: job.results[0].domainMismatchScore,
        confidence: job.results[0].confidence,
        reasons: job.results[0].reasons,
        critical_flags: job.results[0].criticalFlags,
        details: job.results[0].payload,
      } : null,
      error_code: job.errorCode,
      created_at: job.createdAt,
      image: {
        mime_type: job.imageAsset.mimeType,
        size_bytes: Number(job.imageAsset.sizeBytes),
        width: job.imageAsset.width,
        height: job.imageAsset.height,
      },
    };
  }

  async list(filters: ModerationListFilters, role: AdminRole): Promise<Record<string, unknown>> {
    const conditions: Prisma.ModerationJobWhereInput[] = [];
    if (filters.decision) conditions.push({ OR: [{ effectiveDecision: filters.decision }, { results: { some: { decision: filters.decision } } }] });
    if (filters.search) conditions.push({ OR: [{ id: { contains: filters.search, mode: 'insensitive' } }, { applicationId: { contains: filters.search, mode: 'insensitive' } }] });
    const where: Prisma.ModerationJobWhereInput = {
      ...(filters.applicationId ? { applicationId: filters.applicationId } : {}),
      ...(filters.pipeline ? { pipeline: filters.pipeline } : {}),
      ...(filters.status ? { status: filters.status as 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' } : {}),
      ...(filters.from || filters.to ? { createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } } : {}),
      ...(conditions.length ? { AND: conditions } : {}),
    };
    const [total, jobs] = await this.prisma.$transaction([
      this.prisma.moderationJob.count({ where }),
      this.prisma.moderationJob.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize, include: { imageAsset: true, results: { orderBy: { createdAt: 'desc' }, take: 1 }, invocations: { select: { costUsd: true } } } }),
    ]);
    return {
      page: filters.page, page_size: filters.pageSize, total,
      items: jobs.map((job) => {
        const result = job.results[0];
        return {
          job_id: job.id, status: job.status.toLowerCase(), application_id: job.applicationId,
          mime_type: job.imageAsset.mimeType, width: job.imageAsset.width, height: job.imageAsset.height,
          nsfw_risk_score: result?.nsfwRiskScore ?? null, domain_mismatch_score: result?.domainMismatchScore ?? null,
          decision: job.effectiveDecision ?? result?.decision ?? null, effective_decision: job.effectiveDecision,
          preview_allowed: role === 'SPECIALIST' || result?.decision !== 'CRITICAL_REVIEW',
          pipeline: job.pipeline, duration_ms: job.startedAt && job.completedAt ? job.completedAt.getTime() - job.startedAt.getTime() : null,
          ai_cost_usd: job.invocations.reduce((sum, invocation) => sum + Number(invocation.costUsd ?? 0), 0),
          created_at: job.createdAt, review_assignee_id: job.reviewAssigneeId, review_version: job.reviewVersion,
        };
      }),
    };
  }

  async dashboard(): Promise<Record<string, unknown>> {
    const [total, completed, errors, review, aggregates, cost, invocations, peopleCount, deepRuns, queue] = await Promise.all([
      this.prisma.moderationJob.count(),
      this.prisma.moderationJob.count({ where: { status: 'COMPLETED' } }),
      this.prisma.moderationJob.count({ where: { status: 'FAILED' } }),
      this.prisma.moderationJob.count({ where: { effectiveDecision: null, results: { some: { decision: { in: ['REVIEW', 'CRITICAL_REVIEW'] } } } } }),
      this.prisma.moderationResult.aggregate({ _avg: { nsfwRiskScore: true } }),
      this.prisma.modelInvocation.aggregate({ _sum: { costUsd: true }, _count: { id: true } }),
      this.prisma.modelInvocation.count(),
      this.prisma.moderationResult.count({ where: { payload: { path: ['people_object_detection', 'humans', 'present'], equals: true } } }),
      this.prisma.stageExecution.count({ where: { stageType: { in: ['relationship_analysis', 'composition_analysis', 'context_analysis', 'crop_analysis', 'ocr_analysis'] } } }),
      this.queue.getCounts(),
    ]);
    const avgDuration = await this.prisma.$queryRaw<Array<{ average_ms: number | null }>>`
      SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::float AS average_ms
      FROM moderation_jobs WHERE status = 'COMPLETED' AND started_at IS NOT NULL AND completed_at IS NOT NULL
    `;
    return {
      total, completed, approved: await this.prisma.moderationJob.count({ where: { OR: [{ effectiveDecision: 'APPROVED' }, { effectiveDecision: null, results: { some: { decision: 'ALLOW' } } }] } }),
      rejected: await this.prisma.moderationJob.count({ where: { OR: [{ effectiveDecision: 'REJECTED' }, { effectiveDecision: null, results: { some: { decision: 'RESTRICT' } } }] } }), review, errors,
      average_nsfw_risk: aggregates._avg.nsfwRiskScore === null ? null : Math.round(aggregates._avg.nsfwRiskScore),
      average_duration_ms: avgDuration[0]?.average_ms === null || avgDuration[0]?.average_ms === undefined ? null : Math.round(avgDuration[0].average_ms),
      openrouter_cost_usd: Number(cost._sum.costUsd ?? 0), model_calls: invocations, detected_people: peopleCount,
      deep_analysis_runs: deepRuns, queue,
    };
  }

  async getAdminDetail(id: string, role: AdminRole): Promise<Record<string, unknown>> {
    const job = await this.prisma.moderationJob.findUnique({ where: { id }, include: {
      imageAsset: true, pipelineVersion: true, results: { orderBy: { createdAt: 'desc' } },
      stageExecutions: { orderBy: { startedAt: 'asc' }, include: { invocations: true } },
      invocations: { orderBy: { createdAt: 'asc' } }, reviewDecisions: { orderBy: { createdAt: 'asc' } }, auditLogs: { orderBy: { createdAt: 'asc' } },
    } });
    if (!job) throw new NotFoundException('Moderation job was not found.');
    const latest = job.results[0];
    if (latest?.decision === 'CRITICAL_REVIEW' && role !== 'SPECIALIST') throw new ForbiddenException('This item requires a specialist reviewer.');
    return {
      job_id: job.id, status: job.status.toLowerCase(), application_id: job.applicationId, pipeline: job.pipeline, pipeline_version: job.pipelineVersion ? { id: job.pipelineVersion.id, version: job.pipelineVersion.version, name: job.pipelineVersion.name } : null,
      created_at: job.createdAt, started_at: job.startedAt, completed_at: job.completedAt, effective_decision: job.effectiveDecision,
      review_assignee_id: job.reviewAssigneeId, review_version: job.reviewVersion,
      image: { mime_type: job.imageAsset.mimeType, size_bytes: Number(job.imageAsset.sizeBytes), width: job.imageAsset.width, height: job.imageAsset.height, sha256: job.imageAsset.sha256 },
      result: latest ? { nsfw_risk_score: latest.nsfwRiskScore, domain_mismatch_score: latest.domainMismatchScore, confidence: latest.confidence, decision: latest.decision, critical_flags: latest.criticalFlags, reasons: latest.reasons, details: latest.payload } : null,
      stages: job.stageExecutions, invocations: job.invocations.map((call) => ({ ...call, costUsd: call.costUsd?.toString() ?? null })),
      review_decisions: job.reviewDecisions, audit: job.auditLogs,
    };
  }

  async getAdminImage(id: string, role: AdminRole): Promise<{ buffer: Buffer; mimeType: string }> {
    const job = await this.prisma.moderationJob.findUnique({ where: { id }, include: { imageAsset: true, results: { orderBy: { createdAt: 'desc' }, take: 1 } } });
    if (!job) throw new NotFoundException('Moderation job was not found.');
    if (job.results[0]?.decision === 'CRITICAL_REVIEW' && role !== 'SPECIALIST') throw new ForbiddenException('This image requires a specialist reviewer.');
    const buffer = await this.storage.getObject(job.imageAsset.objectKey);
    return { buffer, mimeType: job.imageAsset.mimeType };
  }

  async claimReview(id: string, actorId: string, role: AdminRole): Promise<{ review_version: number }> {
    const job = await this.prisma.moderationJob.findUnique({ where: { id }, include: { results: { orderBy: { createdAt: 'desc' }, take: 1 } } });
    if (!job) throw new NotFoundException('Moderation job was not found.');
    if (!['REVIEW', 'CRITICAL_REVIEW'].includes(job.results[0]?.decision ?? '') || job.effectiveDecision) throw new ConflictException('This job is not waiting for manual review.');
    if (job.results[0]?.decision === 'CRITICAL_REVIEW' && role !== 'SPECIALIST') throw new ForbiddenException('A specialist is required to claim this critical review.');
    if (job.reviewAssigneeId && job.reviewAssigneeId !== actorId) throw new ConflictException('This review is already assigned to another moderator.');
    if (job.reviewAssigneeId === actorId) return { review_version: job.reviewVersion };
    const version = job.reviewVersion + 1;
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.moderationJob.updateMany({ where: { id, reviewAssigneeId: null, effectiveDecision: null, reviewVersion: job.reviewVersion }, data: { reviewAssigneeId: actorId, reviewClaimedAt: new Date(), reviewVersion: version } });
      if (claimed.count !== 1) throw new ConflictException('Another moderator claimed this review first.');
      await tx.auditLog.create({ data: { jobId: id, actorId, action: 'REVIEW_CLAIMED', entityType: 'MODERATION_JOB', entityId: id, before: { review_assignee_id: null }, after: { review_assignee_id: actorId, review_version: version } } });
    });
    return { review_version: version };
  }

  async decideReview(id: string, actorId: string, role: AdminRole, input: ReviewDecisionInput): Promise<{ decision: string; review_version: number }> {
    const job = await this.prisma.moderationJob.findUnique({ where: { id }, include: { results: { orderBy: { createdAt: 'desc' }, take: 1 } } });
    if (!job) throw new NotFoundException('Moderation job was not found.');
    const automated = job.results[0];
    if (!automated || !['REVIEW', 'CRITICAL_REVIEW'].includes(automated.decision) || job.effectiveDecision) throw new ConflictException('This job is not waiting for manual review.');
    if (automated.decision === 'CRITICAL_REVIEW' && role !== 'SPECIALIST') throw new ConflictException('A specialist is required to resolve this critical review.');
    if (input.action === 'REJECTED' && !['EXPLICIT_CONTENT', 'SEXUALIZED_CONTENT', 'DOMAIN_MISMATCH', 'UNSUPPORTED_CONTENT', 'POLICY_VIOLATION', 'OTHER'].includes(input.reason ?? '')) throw new BadRequestException('A valid rejection reason is required.');
    if (job.reviewAssigneeId !== actorId || job.reviewVersion !== input.reviewVersion) throw new ConflictException('Claim this review first; its version or assignee has changed.');
    if (automated.nsfwRiskScore >= 70 && !input.comment?.trim()) throw new BadRequestException('A reason is required for this high-risk decision.');
    const decision = input.action === 'APPROVED' ? 'APPROVED' : 'REJECTED';
    const version = job.reviewVersion + 1;
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.moderationJob.updateMany({ where: { id, reviewAssigneeId: actorId, reviewVersion: input.reviewVersion, effectiveDecision: null }, data: { effectiveDecision: decision, reviewVersion: version } });
      if (updated.count !== 1) throw new ConflictException('The review changed while you were deciding. Reload and try again.');
      await tx.reviewDecision.create({ data: { jobId: id, actorId, action: input.action, rejectionReason: input.reason, comment: input.comment?.trim() || null, reviewVersion: version } });
      await tx.auditLog.create({ data: { jobId: id, actorId, action: `REVIEW_${input.action}`, entityType: 'MODERATION_JOB', entityId: id, before: { effective_decision: null, review_version: input.reviewVersion }, after: { effective_decision: decision, review_version: version }, metadata: { reason: input.reason ?? null, comment: input.comment?.trim() ?? null } } });
    });
    return { decision, review_version: version };
  }

  private async getOrCreateAsset(file: Express.Multer.File, image: Awaited<ReturnType<ImageValidationService['validate']>>) {
    const existing = await this.prisma.imageAsset.findUnique({ where: { sha256: image.sha256 } });
    if (existing) return existing;

    const objectKey = `originals/${randomUUID()}.${image.extension}`;
    await this.storage.putObject(objectKey, file.buffer, image.mimeType);
    try {
      return await this.prisma.imageAsset.create({
        data: {
          sha256: image.sha256,
          objectKey,
          mimeType: image.mimeType,
          originalName: safeOriginalName(file.originalname),
          sizeBytes: BigInt(image.sizeBytes),
          width: image.width,
          height: image.height,
          frameCount: image.frameCount,
        },
      });
    } catch (error) {
      await this.storage.deleteObject(objectKey);
      if (isUniqueConstraintError(error)) {
        const concurrentAsset = await this.prisma.imageAsset.findUnique({ where: { sha256: image.sha256 } });
        if (concurrentAsset) return concurrentAsset;
      }
      throw error;
    }
  }

  private reuseIdempotentJob(
    previous: { id: string; applicationId: string; imageAssetId: string; status: string },
    assetId: string,
    applicationId: string,
  ): { job_id: string; status: string } {
    if (previous.applicationId !== applicationId || previous.imageAssetId !== assetId) {
      throw new ConflictException('The idempotency key was already used for a different request.');
    }
    return { job_id: previous.id, status: previous.status.toLowerCase() };
  }
}

function safeOriginalName(name: string): string {
  const basename = name.replace(/[\u0000-\u001f\u007f]/g, '').split(/[\\/]/).pop() ?? 'upload';
  return basename.slice(0, 255) || 'upload';
}

function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
