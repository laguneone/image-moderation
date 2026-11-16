import { Injectable } from '@nestjs/common';
import { ConfigStatus } from '@moderation/database';
import { WorkerPrismaService } from './worker-prisma.service';

export interface ActiveModel {
  modelId: string;
  timeoutMs: number;
  maxTokens: number | null;
  fallbackModelId: string | null;
  generationParams: Record<string, unknown>;
  promptVersionId?: string;
}
export interface ActivePipeline { versionId: string | null; deepAnalysis: boolean; maxImageCrops: number }

@Injectable()
export class WorkerConfigurationService {
  constructor(private readonly prisma: WorkerPrismaService) {}

  async model(key: string, fallbackModelId: string): Promise<ActiveModel> {
    const config = await this.prisma.modelConfiguration.findFirst({ where: { key, status: ConfigStatus.ACTIVE }, orderBy: { version: 'desc' } });
    if (!config) return { modelId: fallbackModelId, timeoutMs: 90_000, maxTokens: null, fallbackModelId: null, generationParams: {} };
    return { modelId: config.openRouterModelId, timeoutMs: config.timeoutMs, maxTokens: config.maxTokens, fallbackModelId: config.fallbackModelId, generationParams: isRecord(config.generationParams) ? config.generationParams : {} };
  }

  async prompt(key: string, fallback: string): Promise<{ content: string; id: string | undefined }> {
    const prompt = await this.prisma.promptVersion.findFirst({ where: { template: { key }, status: ConfigStatus.ACTIVE }, orderBy: { version: 'desc' } });
    return prompt ? { content: prompt.content, id: prompt.id } : { content: fallback, id: undefined };
  }

  async pinPipeline(jobId: string, pipelineKey: string, pinnedId: string | null): Promise<ActivePipeline> {
    const version = pinnedId
      ? await this.prisma.pipelineVersion.findUnique({ where: { id: pinnedId }, select: { id: true, configuration: true } })
      : await this.prisma.pipelineVersion.findFirst({ where: { pipelineKey, status: ConfigStatus.ACTIVE }, orderBy: { version: 'desc' }, select: { id: true, configuration: true } });
    if (!version) return { versionId: null, deepAnalysis: true, maxImageCrops: 4 };
    if (!pinnedId) await this.prisma.moderationJob.updateMany({ where: { id: jobId, pipelineVersionId: null }, data: { pipelineVersionId: version.id } });
    const config = isRecord(version.configuration) ? version.configuration : {};
    const deepAnalysis = config.deepAnalysis !== false;
    const cropsValue = config.maxImageCrops;
    const maxImageCrops = typeof cropsValue === 'number' && Number.isSafeInteger(cropsValue) ? Math.min(4, Math.max(0, cropsValue)) : 4;
    return { versionId: version.id, deepAnalysis, maxImageCrops };
  }

  async activeRules(): Promise<Array<{ key: string; version: number; conditions: unknown; actions: unknown; applicationIds: string[] }>> {
    return this.prisma.ruleVersion.findMany({ where: { status: ConfigStatus.ACTIVE, enabled: true }, orderBy: { priority: 'asc' }, select: { key: true, version: true, conditions: true, actions: true, applicationIds: true } });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
