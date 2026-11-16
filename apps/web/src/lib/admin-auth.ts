import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface AdminUser { id: string; password: string; role: 'ADMIN' | 'SPECIALIST' }
export interface AdminSession { id: string; role: 'ADMIN' | 'SPECIALIST'; expiresAt: number }
export const ADMIN_COOKIE = 'moderation_admin_session';
const SESSION_SECONDS = 8 * 60 * 60;

export function getAdminUsers(): AdminUser[] {
  const raw = process.env.ADMIN_USERS_JSON?.trim();
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((user): user is AdminUser => isRecord(user)
      && typeof user.id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(user.id)
      && typeof user.password === 'string' && user.password.length >= 12
      && (user.role === 'ADMIN' || user.role === 'SPECIALIST'));
  } catch {
    return [];
  }
}

export function authenticateAdmin(id: string, password: string): AdminUser | null {
  const user = getAdminUsers().find((entry) => safeEqual(entry.id, id));
  const expected = user?.password ?? 'unconfigured-account-password';
  if (!safeEqual(expected, password) || !user) return null;
  return user;
}

export function createAdminToken(user: AdminUser): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ id: user.id, role: user.role, expiresAt: now + SESSION_SECONDS, nonce: randomBytes(16).toString('base64url') })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifyAdminToken(token: string | undefined): AdminSession | null {
  if (Buffer.byteLength(process.env.ADMIN_SESSION_SECRET ?? '') < 32) return null;
  if (!token || token.length > 2_048) return null;
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!safeEqual(sign(payload), signature)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!isRecord(parsed) || typeof parsed.id !== 'string' || (parsed.role !== 'ADMIN' && parsed.role !== 'SPECIALIST') || typeof parsed.expiresAt !== 'number' || parsed.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    const currentUser = getAdminUsers().find((user) => user.id === parsed.id && user.role === parsed.role);
    return currentUser ? { id: currentUser.id, role: currentUser.role, expiresAt: parsed.expiresAt } : null;
  } catch {
    return null;
  }
}

export function sessionCookie(token: string, clear = false): string {
  const security = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  if (clear) return `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${security}`;
  return `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${security}`;
}

function sign(payload: string): string {
  const secret = process.env.ADMIN_SESSION_SECRET ?? '';
  if (Buffer.byteLength(secret) < 32) throw new Error('ADMIN_SESSION_SECRET must contain at least 32 bytes.');
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
