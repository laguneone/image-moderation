import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
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
    decision: null;
    error_code: string | null;
    created_at: Date;
    image: { mime_type: string; size_bytes: number; width: number; height: number };
  }> {
    const job = await this.prisma.moderationJob.findUnique({
      where: { id },
      include: { imageAsset: true },
    });
    if (!job) throw new NotFoundException('Moderation job was not found.');

    return {
      job_id: job.id,
      status: job.status.toLowerCase(),
      decision: null,
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
