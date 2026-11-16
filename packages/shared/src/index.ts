export type ServiceStatus = 'ok';

export interface HealthResponse {
  status: ServiceStatus;
  service: 'api';
}

export const MODERATION_QUEUE_NAME = 'moderation';
export { evaluateRules } from './rule-engine';
export type { RuntimeRule, RuleOutcome } from './rule-engine';

export interface ModerationQueuePayload {
  moderationJobId: string;
  imageAssetId: string;
}

export function getRedisConnectionOptions(redisUrl: string): import('ioredis').RedisOptions {
  const parsedUrl = new URL(redisUrl);
  const database = parsedUrl.pathname.slice(1);
  const options: import('ioredis').RedisOptions = {
    host: parsedUrl.hostname,
    port: parsedUrl.port ? Number(parsedUrl.port) : 6379,
    maxRetriesPerRequest: null,
  };

  if (parsedUrl.username) options.username = decodeURIComponent(parsedUrl.username);
  if (parsedUrl.password) options.password = decodeURIComponent(parsedUrl.password);
  if (database) options.db = Number(database);
  if (parsedUrl.protocol === 'rediss:') options.tls = {};

  return options;
}
