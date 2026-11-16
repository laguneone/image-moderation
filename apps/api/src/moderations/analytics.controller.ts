import { BadRequestException, Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiKeyGuard } from '../common/api-key.guard';
import { PrismaService } from '../database/prisma.service';

@Controller('admin/analytics')
@UseGuards(ApiKeyGuard)
export class AnalyticsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async report(@Query() query: Record<string, string | undefined>): Promise<Record<string, unknown>> {
    const { from, to } = period(query);
    const invocations = await this.prisma.modelInvocation.groupBy({
      by: ['modelId'], where: { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } },
      _count: { id: true }, _sum: { costUsd: true, inputTokens: true, outputTokens: true }, _avg: { latencyMs: true },
    });
    const statuses = await this.prisma.modelInvocation.groupBy({
      by: ['modelId', 'status'], where: { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }, _count: { id: true },
    });
    const [decisions, jobs, errors, manualApproved, manualRejected, duration, trend, stages, stageStatuses, deepStats, costPerJob, reasons, reviewAlerts] = await Promise.all([
      this.prisma.moderationResult.groupBy({ by: ['decision'], where: { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }, _count: { id: true }, _avg: { nsfwRiskScore: true } }),
      this.prisma.moderationJob.count({ where: { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } }),
      this.prisma.moderationJob.count({ where: { status: 'FAILED', createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } }),
      this.prisma.reviewDecision.count({ where: { action: 'APPROVED', createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } }),
      this.prisma.reviewDecision.count({ where: { action: 'REJECTED', createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } }),
      this.prisma.$queryRaw<Array<{ average_ms: number | null }>>`SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::float AS average_ms FROM moderation_jobs WHERE status = 'COMPLETED' AND started_at IS NOT NULL AND completed_at IS NOT NULL AND (${from ?? null}::timestamp IS NULL OR created_at >= ${from ?? null}) AND (${to ?? null}::timestamp IS NULL OR created_at <= ${to ?? null})`,
      this.prisma.$queryRaw<Array<{ day: Date; count: bigint; failed: bigint }>>`SELECT DATE_TRUNC('day', created_at) AS day, COUNT(*)::bigint AS count, COUNT(*) FILTER (WHERE status = 'FAILED')::bigint AS failed FROM moderation_jobs WHERE (${from ?? null}::timestamp IS NULL OR created_at >= ${from ?? null}) AND (${to ?? null}::timestamp IS NULL OR created_at <= ${to ?? null}) GROUP BY DATE_TRUNC('day', created_at) ORDER BY day`,
      this.prisma.stageExecution.groupBy({ by: ['stageType'], where: { startedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }, _count: { id: true }, _avg: { durationMs: true } }),
      this.prisma.stageExecution.groupBy({ by: ['stageType', 'status'], where: { startedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }, _count: { id: true } }),
      this.prisma.$queryRaw<Array<{ deep_jobs: bigint; completed_jobs: bigint }>>`SELECT COUNT(DISTINCT j.id) FILTER (WHERE s.stage_type IN ('relationship_analysis','composition_analysis','context_analysis','crop_analysis','ocr_analysis'))::bigint AS deep_jobs, COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'COMPLETED')::bigint AS completed_jobs FROM moderation_jobs j LEFT JOIN stage_executions s ON s.job_id = j.id WHERE (${from ?? null}::timestamp IS NULL OR j.created_at >= ${from ?? null}) AND (${to ?? null}::timestamp IS NULL OR j.created_at <= ${to ?? null})`,
      this.prisma.$queryRaw<Array<{ known_cost_usd: number | null; jobs_with_known_cost: bigint }>>`SELECT AVG(per_job.total_cost)::float AS known_cost_usd, COUNT(*)::bigint AS jobs_with_known_cost FROM (SELECT job_id, SUM(cost_usd)::float AS total_cost FROM model_invocations WHERE cost_usd IS NOT NULL AND (${from ?? null}::timestamp IS NULL OR created_at >= ${from ?? null}) AND (${to ?? null}::timestamp IS NULL OR created_at <= ${to ?? null}) GROUP BY job_id) per_job`,
      this.prisma.$queryRaw<Array<{ reason: string; count: bigint }>>`SELECT reason_item.reason, COUNT(*)::bigint AS count FROM moderation_results mr CROSS JOIN LATERAL jsonb_array_elements_text(mr.reasons) AS reason_item(reason) WHERE (${from ?? null}::timestamp IS NULL OR mr.created_at >= ${from ?? null}) AND (${to ?? null}::timestamp IS NULL OR mr.created_at <= ${to ?? null}) GROUP BY reason_item.reason ORDER BY count DESC LIMIT 20`,
      this.prisma.moderationJob.count({ where: { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) }, results: { some: { decision: { in: ['REVIEW', 'CRITICAL_REVIEW'] } } } } }),
    ]);
    const statusByModel = new Map<string, Record<string, number>>();
    for (const row of statuses) statusByModel.set(row.modelId, { ...(statusByModel.get(row.modelId) ?? {}), [row.status.toLowerCase()]: row._count.id });
    const stageStatusCounts = new Map<string, Record<string, number>>();
    for (const row of stageStatuses) stageStatusCounts.set(row.stageType, { ...(stageStatusCounts.get(row.stageType) ?? {}), [row.status.toLowerCase()]: row._count.id });
    const decisionsSummary = decisions.map((row) => ({ decision: row.decision, count: row._count.id, average_nsfw_risk: row._avg.nsfwRiskScore === null ? null : Math.round(row._avg.nsfwRiskScore) }));
    const suspicious = decisionsSummary.filter((row) => row.decision === 'REVIEW' || row.decision === 'CRITICAL_REVIEW').reduce((sum, row) => sum + row.count, 0);
    const deepJobs = Number(deepStats[0]?.deep_jobs ?? 0); const completedJobs = Number(deepStats[0]?.completed_jobs ?? 0);
    return {
      period: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
      summary: { jobs, errors, manual_approved: manualApproved, manual_rejected: manualRejected,
        suspicious_jobs: suspicious, review_alerts: reviewAlerts,
        error_rate_percent: jobs === 0 ? null : Math.round((errors / jobs) * 10_000) / 100,
        average_duration_ms: duration[0]?.average_ms === null || duration[0]?.average_ms === undefined ? null : Math.round(duration[0].average_ms),
        average_known_cost_per_image_usd: costPerJob[0]?.known_cost_usd ?? null, images_with_known_cost: Number(costPerJob[0]?.jobs_with_known_cost ?? 0),
        deep_analysis_jobs: deepJobs, deep_analysis_percent: completedJobs === 0 ? null : Math.round((deepJobs / completedJobs) * 10_000) / 100,
        manual_review_resolution_percent: reviewAlerts === 0 ? null : Math.round(((manualApproved + manualRejected) / reviewAlerts) * 10_000) / 100 },
      models: invocations.map((row) => ({ model_id: row.modelId, calls: row._count.id, statuses: statusByModel.get(row.modelId) ?? {},
        input_tokens: row._sum.inputTokens, output_tokens: row._sum.outputTokens, cost_usd: row._sum.costUsd === null ? null : Number(row._sum.costUsd), average_latency_ms: row._avg.latencyMs === null ? null : Math.round(row._avg.latencyMs) })),
      decisions: decisionsSummary,
      daily: trend.map((row) => ({ day: row.day.toISOString().slice(0, 10), jobs: Number(row.count), errors: Number(row.failed) })),
      stages: stages.map((row) => ({ stage: row.stageType, calls: row._count.id, failed: stageStatusCounts.get(row.stageType)?.failed ?? 0, average_duration_ms: row._avg.durationMs === null ? null : Math.round(row._avg.durationMs) })),
      reasons: reasons.map((row) => ({ reason: row.reason, count: Number(row.count) })),
      quality_note: 'Ручные решения и распределение причин являются операционными сигналами, а не точностью классификации. False Positive Rate, False Negative Rate, precision и recall требуют контрольной разметки.',
    };
  }

  @Get('export')
  async export(@Query() query: Record<string, string | undefined>, @Res() response: Response): Promise<void> {
    const { from, to } = period(query);
    const jobs = await this.prisma.moderationJob.findMany({ where: { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }, orderBy: { createdAt: 'desc' }, take: 5_000, include: { results: { orderBy: { createdAt: 'desc' }, take: 1 }, invocations: { select: { costUsd: true } } } });
    const lines = [['job_id', 'created_at', 'status', 'pipeline', 'pipeline_version_id', 'decision', 'nsfw_risk_score', 'domain_mismatch_score', 'model_cost_usd'].map(csv).join(','), ...jobs.map((job) => {
      const result = job.results[0]; const knownCosts = job.invocations.filter((call) => call.costUsd !== null).map((call) => Number(call.costUsd));
      const cost = knownCosts.length ? knownCosts.reduce((sum, value) => sum + value, 0).toFixed(8) : '';
      return [job.id, job.createdAt.toISOString(), job.status, job.pipeline, job.pipelineVersionId ?? '', job.effectiveDecision ?? result?.decision ?? '', result?.nsfwRiskScore ?? '', result?.domainMismatchScore ?? '', cost].map(csv).join(',');
    })];
    response.setHeader('Content-Type', 'text/csv; charset=utf-8'); response.setHeader('Content-Disposition', 'attachment; filename="moderation-report.csv"');
    response.setHeader('Cache-Control', 'private, no-store'); response.end(`\uFEFF${lines.join('\r\n')}`);
  }
}

function period(query: Record<string, string | undefined>): { from?: Date; to?: Date } {
  const from = date(query.from); const to = date(query.to);
  if (from && to && from > to) throw new BadRequestException('Дата начала должна предшествовать дате окончания.');
  if (from && to && to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000) throw new BadRequestException('Период отчёта не может превышать 366 дней.');
  return { from, to };
}
function date(value: string | undefined): Date | undefined { if (!value) return undefined; const parsed = new Date(value); if (!Number.isFinite(parsed.getTime())) throw new BadRequestException('Некорректная дата отчёта.'); return parsed; }
function csv(value: unknown): string { let text = String(value); if (/^[=+@\-\t\r]/u.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"`; }
