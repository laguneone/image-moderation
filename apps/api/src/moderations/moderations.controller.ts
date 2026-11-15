import { BadRequestException, Controller, Get, Headers, Param, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiKeyGuard } from '../common/api-key.guard';
import { ModerationsService } from './moderations.service';

const MAX_UPLOAD_BYTES = positiveIntegerFromEnv('MAX_UPLOAD_BYTES', 10 * 1024 * 1024);

@Controller('moderations')
@UseGuards(ApiKeyGuard)
export class ModerationsController {
  constructor(private readonly moderations: ModerationsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4, fieldSize: 16 * 1024, parts: 5 },
  }))
  async create(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Headers('x-application-id') applicationId: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-pipeline') pipeline: string | undefined,
    @Headers('x-context') contextHeader: string | undefined,
  ): Promise<{ job_id: string; status: string }> {
    if (!file) throw new BadRequestException('A file field is required.');
    if (!applicationId || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(applicationId)) {
      throw new BadRequestException('A valid X-Application-Id header is required.');
    }
    if (idempotencyKey && (idempotencyKey.length > 128 || /[\u0000-\u0020\u007f]/.test(idempotencyKey))) {
      throw new BadRequestException('The Idempotency-Key header must be at most 128 visible ASCII characters.');
    }
    const resolvedPipeline = pipeline?.trim() || 'interior-default';
    if (resolvedPipeline.length > 100) throw new BadRequestException('X-Pipeline must be at most 100 characters.');

    return this.moderations.create({
      file,
      applicationId,
      idempotencyKey,
      pipeline: resolvedPipeline,
      context: parseContext(contextHeader),
    });
  }

  @Get(':id')
  getStatus(@Param('id') id: string): ReturnType<ModerationsService['getStatus']> {
    return this.moderations.getStatus(id);
  }
}

function parseContext(value: string | undefined): Record<string, string | number | boolean | null> {
  if (!value) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new BadRequestException('X-Context must contain a JSON object.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new BadRequestException('X-Context must contain a JSON object.');
  }
  const entries = Object.entries(parsed);
  if (entries.length > 32 || entries.some(([, item]) => !['string', 'number', 'boolean'].includes(typeof item) && item !== null)) {
    throw new BadRequestException('X-Context supports at most 32 scalar fields.');
  }
  return Object.fromEntries(entries) as Record<string, string | number | boolean | null>;
}

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
