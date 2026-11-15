import { Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { WorkerPrismaService } from './worker-prisma.service';
import { getRedisConnectionOptions, MODERATION_QUEUE_NAME, ModerationQueuePayload } from '@moderation/shared';

@Injectable()
class ModerationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ModerationWorker.name);
  private worker: Worker<ModerationQueuePayload> | undefined;

  constructor(private readonly prisma: WorkerPrismaService) {}

  onModuleInit(): void {
    const parsedConcurrency = Number(process.env.WORKER_CONCURRENCY ?? 4);
    const concurrency = Number.isSafeInteger(parsedConcurrency) && parsedConcurrency > 0 ? parsedConcurrency : 4;
    this.worker = new Worker<ModerationQueuePayload>(
      MODERATION_QUEUE_NAME,
      async (job: Job<ModerationQueuePayload>) => this.acceptJob(job),
      {
        connection: getRedisConnectionOptions(process.env.REDIS_URL ?? 'redis://redis:6379'),
        concurrency,
      },
    );
    this.worker.on('completed', (job) => this.logger.log(`Accepted moderation job ${job.data.moderationJobId}.`));
    this.worker.on('failed', (job, error) => {
      this.logger.error(`Queue task failed${job ? ` for ${job.data.moderationJobId}` : ''}: ${error.message}`);
      if (job && job.attemptsMade >= Number(job.opts.attempts ?? 1)) {
        void this.markFailed(job.data.moderationJobId);
      }
    });
    this.worker.on('error', (error) => this.logger.error(`Queue worker error: ${error.message}`));
    this.logger.log(`Moderation queue consumer started with concurrency ${concurrency}.`);
  }

  private async acceptJob(job: Job<ModerationQueuePayload>): Promise<void> {
    await this.prisma.moderationJob.updateMany({
      where: { id: job.data.moderationJobId, status: 'QUEUED' },
      data: { status: 'PROCESSING', startedAt: new Date() },
    });
  }

  private async markFailed(id: string): Promise<void> {
    try {
      await this.prisma.moderationJob.updateMany({
        where: { id, status: { in: ['QUEUED', 'PROCESSING'] } },
        data: { status: 'FAILED', errorCode: 'QUEUE_PROCESSING_FAILED', completedAt: new Date() },
      });
    } catch (error) {
      this.logger.error(`Could not persist failure for ${id}: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}

@Module({ providers: [WorkerPrismaService, ModerationWorker] })
export class WorkerModule {}
