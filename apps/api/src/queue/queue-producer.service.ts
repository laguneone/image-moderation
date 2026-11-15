import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { getRedisConnectionOptions, MODERATION_QUEUE_NAME, ModerationQueuePayload } from '@moderation/shared';

@Injectable()
export class QueueProducerService implements OnModuleDestroy {
  private readonly queue = new Queue<ModerationQueuePayload>(MODERATION_QUEUE_NAME, {
    connection: getRedisConnectionOptions(process.env.REDIS_URL ?? 'redis://redis:6379'),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    },
  });

  async enqueue(payload: ModerationQueuePayload): Promise<void> {
    await this.queue.add('moderate-image', payload, { jobId: payload.moderationJobId });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
