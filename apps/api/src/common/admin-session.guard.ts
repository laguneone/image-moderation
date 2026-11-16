import { createHmac, timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class AdminSessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const token = context.switchToHttp().getRequest<Request>().header('x-admin-session');
    const secret = process.env.ADMIN_SESSION_SECRET ?? '';
    if (Buffer.byteLength(secret) < 32 || !token || token.length > 2048) throw new UnauthorizedException('A signed admin session is required.');
    const separator = token.lastIndexOf('.');
    if (separator <= 0) throw new UnauthorizedException('The admin session is invalid.');
    const payload = token.slice(0, separator); const signature = token.slice(separator + 1);
    const expected = createHmac('sha256', secret).update(payload).digest('base64url');
    if (!equal(signature, expected)) throw new UnauthorizedException('The admin session is invalid.');
    try {
      const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (!isRecord(parsed) || typeof parsed.id !== 'string' || parsed.role !== 'ADMIN' || typeof parsed.expiresAt !== 'number' || parsed.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error();
    } catch { throw new UnauthorizedException('An administrator session is required.'); }
    return true;
  }
}
function equal(left: string, right: string): boolean { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
