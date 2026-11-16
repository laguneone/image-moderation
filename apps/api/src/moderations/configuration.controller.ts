import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ConfigStatus, Prisma } from '@moderation/database';
import { ApiKeyGuard } from '../common/api-key.guard';
import { PrismaService } from '../database/prisma.service';
import { AdminSessionGuard } from '../common/admin-session.guard';
import { evaluateRules } from '@moderation/shared';

@Controller('admin/configuration')
@UseGuards(ApiKeyGuard, AdminSessionGuard)
export class ConfigurationController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Headers('x-admin-role') role: string | undefined): Promise<Record<string, unknown>> {
    assertAdmin(role);
    const [models, pipelines, prompts, rules] = await Promise.all([
      this.prisma.modelConfiguration.findMany({ orderBy: [{ key: 'asc' }, { version: 'desc' }] }),
      this.prisma.pipelineVersion.findMany({ orderBy: [{ pipelineKey: 'asc' }, { version: 'desc' }] }),
      this.prisma.promptVersion.findMany({ include: { template: true }, orderBy: [{ template: { key: 'asc' } }, { version: 'desc' }] }),
      this.prisma.ruleVersion.findMany({ orderBy: [{ priority: 'asc' }, { key: 'asc' }, { version: 'desc' }] }),
    ]);
    return { models, pipelines, prompts, rules };
  }

  @Get('history')
  async history(@Headers('x-admin-role') role: string | undefined): Promise<unknown> {
    assertAdmin(role);
    return this.prisma.configurationAuditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 250 });
  }

  @Get('pipelines/compare')
  async comparePipelines(@Query('left') left: string | undefined, @Query('right') right: string | undefined, @Headers('x-admin-role') role: string | undefined): Promise<Record<string, unknown>> {
    assertAdmin(role);
    if (!left || !right || left.length > 128 || right.length > 128 || left === right) throw new BadRequestException('Укажите два разных идентификатора версий pipeline.');
    const [first, second] = await Promise.all([
      this.prisma.pipelineVersion.findUnique({ where: { id: left } }),
      this.prisma.pipelineVersion.findUnique({ where: { id: right } }),
    ]);
    if (!first || !second) throw new BadRequestException('Одна из версий pipeline не найдена.');
    const firstConfig = isRecord(first.configuration) ? first.configuration : {};
    const secondConfig = isRecord(second.configuration) ? second.configuration : {};
    const keys = [...new Set([...Object.keys(firstConfig), ...Object.keys(secondConfig)])].sort();
    const [leftMetrics, rightMetrics] = await Promise.all([this.pipelineMetrics(first.id), this.pipelineMetrics(second.id)]);
    return { left: { id: first.id, key: first.pipelineKey, version: first.version, name: first.name, metrics: leftMetrics }, right: { id: second.id, key: second.pipelineKey, version: second.version, name: second.name, metrics: rightMetrics }, changes: keys.filter((key) => JSON.stringify(firstConfig[key]) !== JSON.stringify(secondConfig[key])).map((key) => ({ setting: key, left: firstConfig[key] ?? null, right: secondConfig[key] ?? null })) };
  }

  @Post('models')
  createModel(@Body() body: unknown, @Headers('x-admin-id') actor: string | undefined, @Headers('x-admin-role') role: string | undefined): Promise<unknown> {
    assertAdmin(role);
    const input = record(body);
    const key = text(input.key, 64); const name = text(input.name, 120); const modelRole = text(input.role, 64);
    const modelId = text(input.openrouter_model_id, 200);
    const timeoutMs = integer(input.timeout_ms ?? 90_000, 1_000, 300_000);
    const maxTokens = input.max_tokens === undefined ? null : integer(input.max_tokens, 1, 32_000);
    const fallback = input.fallback_model_id === undefined || input.fallback_model_id === null || input.fallback_model_id === '' ? null : text(input.fallback_model_id, 200);
    const modalities = input.input_modalities === undefined ? ['image', 'text'] : stringArray(input.input_modalities, 4, 20);
    const structured = input.structured_output === undefined ? false : input.structured_output;
    if (typeof structured !== 'boolean') throw new BadRequestException('structured_output must be boolean.');
    const params = input.generation_params === undefined ? {} : record(input.generation_params);
    assertActor(actor); const actorId = actor;
    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.modelConfiguration.findFirst({ where: { key }, orderBy: { version: 'desc' } });
      const created = await tx.modelConfiguration.create({ data: {
        key, version: (previous?.version ?? 0) + 1, name, role: modelRole, openRouterModelId: modelId, status: ConfigStatus.DRAFT,
        inputModalities: modalities, structuredOutput: structured, generationParams: json(params), timeoutMs, maxTokens,
        fallbackModelId: fallback, createdBy: actorId,
      } });
      await tx.configurationAuditLog.create({ data: { actorId, entityType: 'model', entityId: created.id, action: 'CREATE_DRAFT', after: json({ key, version: created.version, openRouterModelId: modelId }) } });
      return created;
    });
  }

  @Post('pipelines')
  createPipeline(@Body() body: unknown, @Headers('x-admin-id') actor: string | undefined, @Headers('x-admin-role') role: string | undefined): Promise<unknown> {
    assertAdmin(role);
    const input = record(body); const key = text(input.pipeline_key, 100); const name = text(input.name, 120);
    const configuration = record(input.configuration); validatePipelineConfiguration(configuration); assertActor(actor);
    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.pipelineVersion.findFirst({ where: { pipelineKey: key }, orderBy: { version: 'desc' } });
      const created = await tx.pipelineVersion.create({ data: { pipelineKey: key, version: (previous?.version ?? 0) + 1, name, configuration: json(configuration), createdBy: actor } });
      await tx.configurationAuditLog.create({ data: { actorId: actor, entityType: 'pipeline', entityId: created.id, action: 'CREATE_DRAFT', after: json({ key, version: created.version }) } });
      return created;
    });
  }

  @Post('prompts')
  createPrompt(@Body() body: unknown, @Headers('x-admin-id') actor: string | undefined, @Headers('x-admin-role') role: string | undefined): Promise<unknown> {
    assertAdmin(role); assertActor(actor);
    const input = record(body); const key = text(input.key, 64); const name = text(input.name, 120);
    const modelRole = text(input.model_role, 64); const content = text(input.content, 20_000);
    return this.prisma.$transaction(async (tx) => {
      const template = await tx.promptTemplate.upsert({ where: { key }, create: { key, name }, update: { name } });
      const previous = await tx.promptVersion.findFirst({ where: { templateId: template.id }, orderBy: { version: 'desc' } });
      const created = await tx.promptVersion.create({ data: { templateId: template.id, version: (previous?.version ?? 0) + 1, modelRole, content, createdBy: actor } });
      await tx.configurationAuditLog.create({ data: { actorId: actor, entityType: 'prompt', entityId: created.id, action: 'CREATE_DRAFT', after: json({ key, version: created.version }) } });
      return created;
    });
  }

  @Post('rules')
  createRule(@Body() body: unknown, @Headers('x-admin-id') actor: string | undefined, @Headers('x-admin-role') role: string | undefined): Promise<unknown> {
    assertAdmin(role);
    const input = record(body); const key = text(input.key, 64); const name = text(input.name, 120);
    const conditions = record(input.conditions); const actions = record(input.actions);
    const description = input.description === undefined ? null : text(input.description, 2_000);
    const priority = integer(input.priority ?? 100, 0, 100_000);
    const applicationIds = input.application_ids === undefined ? [] : stringArray(input.application_ids, 100, 64);
    validateRule(conditions, actions); assertActor(actor);
    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.ruleVersion.findFirst({ where: { key }, orderBy: { version: 'desc' } });
      const created = await tx.ruleVersion.create({ data: { key, version: (previous?.version ?? 0) + 1, name, description, priority, conditions: json(conditions), actions: json(actions), applicationIds, createdBy: actor } });
      await tx.configurationAuditLog.create({ data: { actorId: actor, entityType: 'rule', entityId: created.id, action: 'CREATE_DRAFT', after: json({ key, version: created.version }) } });
      return created;
    });
  }

  @Post('pipelines/:id/test')
  async testPipeline(@Param('id') id: string, @Body() body: unknown, @Headers('x-admin-role') role: string | undefined): Promise<Record<string, unknown>> {
    assertAdmin(role);
    const input = record(body); const sample = input.sample === undefined ? {} : record(input.sample);
    const allowedFields = ['nsfwUnsafe', 'peoplePresent', 'criticalReview', 'suspiciousText', 'sexualizedContext', 'sexualizedInteraction', 'nsfwRiskScore', 'domainMismatchScore', 'sexualSignalCount', 'confidence'];
    for (const [key, value] of Object.entries(sample)) if (!allowedFields.includes(key) || (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')) throw new BadRequestException('Pipeline test sample contains unsupported fields or values.');
    const pipeline = await this.prisma.pipelineVersion.findUnique({ where: { id } });
    if (!pipeline) throw new BadRequestException('Pipeline version was not found.');
    const rules = await this.prisma.ruleVersion.findMany({ where: { status: ConfigStatus.ACTIVE, enabled: true }, orderBy: { priority: 'asc' }, select: { key: true, version: true, conditions: true, actions: true, applicationIds: true } });
    const matches = evaluateRules(rules, sample, typeof input.application_id === 'string' ? input.application_id : '');
    const config = isRecord(pipeline.configuration) ? pipeline.configuration : {};
    validatePipelineConfiguration(config);
    const crops = typeof config.maxImageCrops === 'number' && Number.isSafeInteger(config.maxImageCrops) ? Math.min(4, Math.max(0, config.maxImageCrops)) : 4;
    const deepEnabled = config.deepAnalysis !== false;
    return { dry_run: true, pipeline: { id: pipeline.id, version: pipeline.version, status: pipeline.status }, sample,
      stages: ['metadata_analysis', 'nsfw_detection', 'people_object_detection', ...(deepEnabled ? ['deep_analysis'] : [])],
      max_image_crops: deepEnabled ? crops : 0, matched_rules: matches.matchedRuleKeys,
      trigger_deep_analysis: deepEnabled && matches.triggerDeepAnalysis, require_review: matches.requireReview };
  }

  @Post(':kind/:id/publish')
  publish(@Param('kind') kind: string, @Param('id') id: string, @Headers('x-admin-id') actor: string | undefined, @Headers('x-admin-role') role: string | undefined): Promise<unknown> {
    assertAdmin(role);
    assertActor(actor);
    return this.prisma.$transaction(async (tx) => {
      if (kind === 'model') return publishVersion(tx, 'modelConfiguration', id, actor);
      if (kind === 'pipeline') return publishVersion(tx, 'pipelineVersion', id, actor);
      if (kind === 'prompt') return publishVersion(tx, 'promptVersion', id, actor);
      if (kind === 'rule') return publishVersion(tx, 'ruleVersion', id, actor);
      throw new BadRequestException('Configuration kind is not supported.');
    });
  }

  private async pipelineMetrics(id: string): Promise<Record<string, unknown>> {
    const [jobs, results, calls, decisions, duration] = await Promise.all([
      this.prisma.moderationJob.count({ where: { pipelineVersionId: id } }),
      this.prisma.moderationResult.aggregate({ where: { job: { pipelineVersionId: id } }, _avg: { nsfwRiskScore: true, domainMismatchScore: true }, _count: { id: true } }),
      this.prisma.modelInvocation.aggregate({ where: { job: { pipelineVersionId: id } }, _sum: { costUsd: true }, _count: { id: true } }),
      this.prisma.moderationResult.groupBy({ by: ['decision'], where: { job: { pipelineVersionId: id } }, _count: { id: true } }),
      this.prisma.$queryRaw<Array<{ average_ms: number | null }>>`SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::float AS average_ms FROM moderation_jobs WHERE pipeline_version_id = ${id} AND status = 'COMPLETED' AND started_at IS NOT NULL AND completed_at IS NOT NULL`,
    ]);
    return { jobs, analyzed: results._count.id, average_nsfw_risk: results._avg.nsfwRiskScore === null ? null : Math.round(results._avg.nsfwRiskScore), average_domain_mismatch: results._avg.domainMismatchScore === null ? null : Math.round(results._avg.domainMismatchScore), model_calls: calls._count.id, known_cost_usd: calls._sum.costUsd === null ? null : Number(calls._sum.costUsd), average_duration_ms: duration[0]?.average_ms === null || duration[0]?.average_ms === undefined ? null : Math.round(duration[0].average_ms), decisions: decisions.map((item) => ({ decision: item.decision, count: item._count.id })) };
  }
}

type Transaction = Prisma.TransactionClient;
async function publishVersion(tx: Transaction, kind: 'modelConfiguration' | 'pipelineVersion' | 'promptVersion' | 'ruleVersion', id: string, actor: string): Promise<unknown> {
  const delegate = tx[kind] as unknown as { findUnique(args: { where: { id: string } }): Promise<{ id: string; key?: string; pipelineKey?: string; templateId?: string; status: ConfigStatus } | null>; updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown>; update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown> };
  const current = await delegate.findUnique({ where: { id } });
  if (!current) throw new BadRequestException('Configuration version was not found.');
  if (current.status === ConfigStatus.ARCHIVED) throw new BadRequestException('Archived configuration cannot be published.');
  const group = kind === 'pipelineVersion' ? { pipelineKey: current.pipelineKey } : kind === 'promptVersion' ? { templateId: current.templateId } : { key: current.key };
  await delegate.updateMany({ where: { ...group, status: ConfigStatus.ACTIVE }, data: { status: ConfigStatus.ARCHIVED } });
  const published = await delegate.update({ where: { id }, data: { status: ConfigStatus.ACTIVE, ...(kind === 'pipelineVersion' ? { publishedAt: new Date() } : {}) } });
  await tx.configurationAuditLog.create({ data: { actorId: actor, entityType: kind, entityId: id, action: 'PUBLISH', after: json({ status: 'ACTIVE' }) } });
  return published;
}

function validateRule(conditions: Record<string, unknown>, actions: Record<string, unknown>): void {
  validateConditions(conditions);
  if (Object.keys(actions).length !== 1 || !['TRIGGER_STAGE', 'REQUIRE_REVIEW'].includes(Object.keys(actions)[0])) throw new BadRequestException('Rule action is not supported.');
  if ('TRIGGER_STAGE' in actions && actions.TRIGGER_STAGE !== 'deep_analysis') throw new BadRequestException('Only deep_analysis can be triggered by a rule.');
  if ('REQUIRE_REVIEW' in actions && actions.REQUIRE_REVIEW !== true) throw new BadRequestException('REQUIRE_REVIEW action must be true.');
}
function validatePipelineConfiguration(configuration: Record<string, unknown>): void {
  if (Object.keys(configuration).some((key) => !['deepAnalysis', 'maxImageCrops'].includes(key))) throw new BadRequestException('Pipeline configuration includes an unsupported setting.');
  if (configuration.deepAnalysis !== undefined && typeof configuration.deepAnalysis !== 'boolean') throw new BadRequestException('deepAnalysis must be boolean.');
  if (configuration.maxImageCrops !== undefined && (!Number.isSafeInteger(configuration.maxImageCrops) || (configuration.maxImageCrops as number) < 0 || (configuration.maxImageCrops as number) > 4)) throw new BadRequestException('maxImageCrops must be an integer from 0 to 4.');
}
function validateConditions(conditions: Record<string, unknown>, depth = 0): void {
  if (depth > 4) throw new BadRequestException('Rule conditions are nested too deeply.');
  const keys = Object.keys(conditions);
  if (keys.length !== 1 || !['all', 'any', 'not', 'field'].includes(keys[0])) throw new BadRequestException('Conditions must use all, any, not or a field predicate.');
  if ('all' in conditions || 'any' in conditions) {
    const branches = conditions.all ?? conditions.any;
    if (!Array.isArray(branches) || branches.length === 0 || branches.length > 20 || branches.some((item) => !isRecord(item))) throw new BadRequestException('Rule condition groups must contain 1 to 20 condition objects.');
    for (const item of branches) validateConditions(item as Record<string, unknown>, depth + 1);
  } else if ('not' in conditions) {
    if (!isRecord(conditions.not)) throw new BadRequestException('NOT requires a condition object.');
    validateConditions(conditions.not, depth + 1);
  } else {
    const allowed = ['nsfwUnsafe', 'peoplePresent', 'criticalReview', 'suspiciousText', 'sexualizedContext', 'sexualizedInteraction', 'nsfwRiskScore', 'domainMismatchScore', 'sexualSignalCount', 'confidence'];
    const operators = ['EQUALS', 'NOT_EQUALS', 'GT', 'LT', 'IN', 'EXISTS', 'CONFIDENCE_GTE'];
    if (typeof conditions.field !== 'string' || !allowed.includes(conditions.field) || !operators.includes(String(conditions.operator))) throw new BadRequestException('Rule predicate field or operator is not supported.');
    if (conditions.operator === 'IN') {
      if (!Array.isArray(conditions.value) || conditions.value.length === 0 || conditions.value.length > 50 || conditions.value.some((value) => typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')) throw new BadRequestException('IN requires a list of 1 to 50 primitive values.');
    } else if (conditions.operator !== 'EXISTS') {
      const value = conditions.value;
      if (typeof value !== 'boolean' && typeof value !== 'string' && typeof value !== 'number') throw new BadRequestException('Rule predicates require a primitive comparison value.');
      if (['GT', 'LT', 'CONFIDENCE_GTE'].includes(String(conditions.operator)) && typeof value !== 'number') throw new BadRequestException('Numeric operators require a numeric comparison value.');
      if (conditions.operator === 'CONFIDENCE_GTE' && (conditions.field !== 'confidence' || typeof value !== 'number' || value < 0 || value > 1)) throw new BadRequestException('CONFIDENCE_GTE requires the confidence field and a threshold from 0 to 1.');
    }
  }
}
function record(value: unknown): Record<string, unknown> { if (!isRecord(value)) throw new BadRequestException('Request body must be an object.'); return value; }
function text(value: unknown, max: number): string { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new BadRequestException('A required text value is invalid.'); return value.trim(); }
function integer(value: unknown, min: number, max: number): number { if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new BadRequestException('An integer value is outside the supported range.'); return value as number; }
function stringArray(value: unknown, maxItems: number, maxLength: number): string[] { if (!Array.isArray(value) || value.length > maxItems || value.some((item) => typeof item !== 'string' || item.length > maxLength)) throw new BadRequestException('A string list is invalid.'); return value as string[]; }
function assertActor(value: string | undefined): asserts value is string { if (!value || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value)) throw new BadRequestException('A valid administrator identity is required.'); }
function assertAdmin(value: string | undefined): void { if (value !== 'ADMIN') throw new BadRequestException('Only administrators can manage configuration.'); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
