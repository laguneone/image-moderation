import { timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expectedKey = process.env.UPLOAD_API_KEY?.trim();
    if (!expectedKey) {
      throw new ServiceUnavailableException('Image upload is disabled until UPLOAD_API_KEY is configured.');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const providedKey = request.header('x-api-key');
    if (!providedKey || !keysMatch(providedKey, expectedKey)) {
      throw new UnauthorizedException('A valid API key is required.');
    }

    return true;
  }
}

function keysMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}
