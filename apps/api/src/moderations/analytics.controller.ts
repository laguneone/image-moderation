import { BadRequestException, Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiKeyGuard } from '../common/api-key.guard';
import { AdminSessionGuard } from '../common/admin-session.guard';
import { PrismaService } from '../database/prisma.service';

@Controller('admin/analytics')
@UseGuards(ApiKeyGuard, AdminSessionGuard)
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
    const [decisions, jobs, errors, manualApproved, manualRejected, duration, trend] = await Promise.all([
      this.prisma.moderationResult.groupBy({ by: ['decision'], where: { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }, _count: { id: true }, _avg: { nsfwRiskScore: true } }),
      this.prisma.moderationJob.count({ where: { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } }),
      this.prisma.moderationJob.count({ where: { status: 'FAILED', createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } }),
      this.prisma.reviewDecision.count({ where: { action: 'APPROVED', createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } }),
      this.prisma.reviewDecision.count({ where: { action: 'REJECTED', createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } }),
      this.prisma.$queryRaw<Array<{ average_ms: number | null }>>`SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::float AS average_ms FROM moderation_jobs WHERE status = 'COMPLETED' AND started_at IS NOT NULL AND completed_at IS NOT NULL AND (${from ?? null}::timestamp IS NULL OR created_at >= ${from ?? null}) AND (${to ?? null}::timestamp IS NULL OR created_at <= ${to ?? null})`,
      this.prisma.$queryRaw<Array<{ day: Date; count: bigint; failed: bigint }>>`SELECT DATE_TRUNC('day', created_at) AS day, COUNT(*)::bigint AS count, COUNT(*) FILTER (WHERE status = 'FAILED')::bigint AS failed FROM moderation_jobs WHERE (${from ?? null}::timestamp IS NULL OR created_at >= ${from ?? null}) AND (${to ?? null}::timestamp IS NULL OR created_at <= ${to ?? null}) GROUP BY DATE_TRUNC('day', created_at) ORDER BY day`,
    ]);
    const statusByModel = new Map<string, Record<string, number>>();
    for (const row of statuses) statusByModel.set(row.modelId, { ...(statusByModel.get(row.modelId) ?? {}), [row.status.toLowerCase()]: row._count.id });
    return {
      period: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
      summary: { jobs, errors, manual_approved: manualApproved, manual_rejected: manualRejected,
        average_duration_ms: duration[0]?.average_ms === null || duration[0]?.average_ms === undefined ? null : Math.round(duration[0].average_ms) },
      models: invocations.map((row) => ({ model_id: row.modelId, calls: row._count.id, statuses: statusByModel.get(row.modelId) ?? {},
        input_tokens: row._sum.inputTokens, output_tokens: row._sum.outputTokens, cost_usd: row._sum.costUsd === null ? null : Number(row._sum.costUsd), average_latency_ms: row._avg.latencyMs === null ? null : Math.round(row._avg.latencyMs) })),
      decisions: decisions.map((row) => ({ decision: row.decision, count: row._count.id, average_nsfw_risk: row._avg.nsfwRiskScore === null ? null : Math.round(row._avg.nsfwRiskScore) })),
      daily: trend.map((row) => ({ day: row.day.toISOString().slice(0, 10), jobs: Number(row.count), errors: Number(row.failed) })),
      quality_note: 'Статистика решений и ручных корректировок показывает операционные сигналы, а не точность классификации без размеченной выборки.',
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
