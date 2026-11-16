import { BadRequestException, Controller, Get, Headers, Param, Post, Query, Res, UseGuards, Body } from '@nestjs/common';
import type { Response } from 'express';
import { ApiKeyGuard } from '../common/api-key.guard';
import { AdminRole, ModerationsService, ReviewDecisionInput } from './moderations.service';

@Controller('admin')
@UseGuards(ApiKeyGuard)
export class AdminController {
  constructor(private readonly moderations: ModerationsService) {}

  @Get('dashboard')
  getDashboard(): ReturnType<ModerationsService['dashboard']> { return this.moderations.dashboard(); }

  @Get('moderations')
  list(@Query() query: Record<string, string | undefined>, @Headers('x-admin-role') role: string | undefined): ReturnType<ModerationsService['list']> {
    const page = parseInteger(query.page, 1, 1, 1_000_000);
    const pageSize = parseInteger(query.page_size, 25, 1, 100);
    const status = allowedValue(query.status, ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED']);
    const decision = allowedValue(query.decision, ['ALLOW', 'REVIEW', 'RESTRICT', 'CRITICAL_REVIEW', 'APPROVED', 'REJECTED']);
    const from = parseDate(query.from);
    const to = parseDate(query.to);
    if (from && to && from > to) throw new BadRequestException('The from date must be before the to date.');
    return this.moderations.list({
      page, pageSize, status, decision, from, to,
      search: boundedString(query.search, 128), applicationId: boundedString(query.application_id, 64), pipeline: boundedString(query.pipeline, 100),
    }, parseRole(role));
  }

  @Get('moderations/:id')
  getDetail(@Param('id') id: string, @Headers('x-admin-role') roleHeader: string | undefined): ReturnType<ModerationsService['getAdminDetail']> {
    return this.moderations.getAdminDetail(id, parseRole(roleHeader));
  }

  @Get('moderations/:id/image')
  async getImage(@Param('id') id: string, @Headers('x-admin-role') roleHeader: string | undefined, @Res() response: Response): Promise<void> {
    const image = await this.moderations.getAdminImage(id, parseRole(roleHeader));
    response.setHeader('Content-Type', image.mimeType);
    response.setHeader('Content-Length', image.buffer.length);
    response.setHeader('Content-Disposition', 'inline');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.end(image.buffer);
  }

  @Post('moderations/:id/claim')
  claim(@Param('id') id: string, @Headers('x-admin-id') actorId: string | undefined, @Headers('x-admin-role') role: string | undefined): ReturnType<ModerationsService['claimReview']> {
    return this.moderations.claimReview(id, parseActor(actorId), parseRole(role));
  }

  @Post('moderations/:id/decision')
  decide(@Param('id') id: string, @Headers('x-admin-id') actorId: string | undefined, @Headers('x-admin-role') role: string | undefined, @Body() body: unknown): ReturnType<ModerationsService['decideReview']> {
    return this.moderations.decideReview(id, parseActor(actorId), parseRole(role), parseDecision(body));
  }
}

function parseRole(value: string | undefined): AdminRole {
  if (value === 'ADMIN' || value === 'SPECIALIST') return value;
  throw new BadRequestException('A valid administrator role is required.');
}

function parseActor(value: string | undefined): string {
  if (!value || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value)) throw new BadRequestException('A valid administrator identity is required.');
  return value;
}

function parseDecision(value: unknown): ReviewDecisionInput {
  if (!isRecord(value) || (value.action !== 'APPROVED' && value.action !== 'REJECTED') || !Number.isSafeInteger(value.review_version) || (value.reason !== undefined && typeof value.reason !== 'string') || (value.comment !== undefined && typeof value.comment !== 'string')) {
    throw new BadRequestException('A valid review action, version, reason and comment are required.');
  }
  const comment = typeof value.comment === 'string' ? value.comment.trim() : undefined;
  if (comment && comment.length > 2_000) throw new BadRequestException('The review comment must be at most 2000 characters.');
  return { action: value.action, reviewVersion: value.review_version as number, reason: value.reason as string | undefined, comment };
}

function parseInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new BadRequestException('A query parameter has an invalid integer value.');
  return parsed;
}

function parseDate(value: string | undefined): Date | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException('A date filter is invalid.');
  return parsed;
}

function boundedString(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = value.trim();
  if (parsed.length > maxLength) throw new BadRequestException('A search filter is too long.');
  return parsed;
}

function allowedValue<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  if (value === undefined || value === '') return undefined;
  if (allowed.includes(value as T)) return value as T;
  throw new BadRequestException('A filter value is not supported.');
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
