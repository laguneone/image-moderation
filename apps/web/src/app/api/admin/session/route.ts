import { authenticateAdmin, createAdminToken, isSameOriginRequest, sessionCookie, verifyAdminToken, ADMIN_COOKIE } from '../../../../lib/admin-auth';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) return Response.json({ error: 'Недопустимый источник запроса.' }, { status: 403 });
  if (Buffer.byteLength(process.env.ADMIN_SESSION_SECRET ?? '') < 32) {
    return Response.json({ error: 'Админ-панель не настроена: укажите ADMIN_SESSION_SECRET.' }, { status: 503 });
  }
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: 'Переданы некорректные данные.' }, { status: 400 }); }
  if (!isRecord(body) || typeof body.id !== 'string' || typeof body.password !== 'string' || body.id.length > 64 || body.password.length > 256) {
    return Response.json({ error: 'Укажите логин и пароль.' }, { status: 400 });
  }
  const user = authenticateAdmin(body.id, body.password);
  if (!user) return Response.json({ error: 'Неверный логин или пароль.' }, { status: 401 });
  return Response.json({ id: user.id, role: user.role }, { headers: { 'Set-Cookie': sessionCookie(createAdminToken(user)), 'Cache-Control': 'no-store' } });
}

export async function DELETE(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) return Response.json({ error: 'Недопустимый источник запроса.' }, { status: 403 });
  const token = cookieValue(request.headers.get('cookie'), ADMIN_COOKIE);
  if (!verifyAdminToken(token)) return Response.json({ error: 'Требуется авторизация.' }, { status: 401 });
  return Response.json({ status: 'ok' }, { headers: { 'Set-Cookie': sessionCookie('', true), 'Cache-Control': 'no-store' } });
}

function cookieValue(header: string | null, name: string): string | undefined {
  return header?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
