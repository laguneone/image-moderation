import { isSameOriginRequest } from '../../../../lib/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> { return proxy(request, context, 'GET'); }
export async function POST(request: Request, context: RouteContext): Promise<Response> { return proxy(request, context, 'POST'); }

async function proxy(request: Request, context: RouteContext, method: 'GET' | 'POST'): Promise<Response> {
  if (method === 'POST' && !isSameOriginRequest(request)) {
    return Response.json({ error: 'Недопустимый источник запроса.' }, { status: 403 });
  }
  const { path } = await context.params;
  if (path.length === 0 || path.some((segment) => !/^[a-zA-Z0-9_-]{1,128}$/.test(segment))) return Response.json({ error: 'Некорректный путь.' }, { status: 404 });
  const apiUrl = process.env.API_INTERNAL_URL;
  const apiKey = process.env.UPLOAD_API_KEY?.trim();
  if (!apiUrl || !apiKey) return Response.json({ error: 'Админ API не настроен.' }, { status: 503 });
  const target = new URL(`/api/v1/admin/${path.map(encodeURIComponent).join('/')}`, apiUrl);
  target.search = new URL(request.url).search;
  const administrativeSection = path[0] === 'configuration' || path[0] === 'analytics';
  const headers = new Headers({ 'x-api-key': apiKey, 'x-admin-id': 'local-admin', 'x-admin-role': administrativeSection ? 'ADMIN' : 'SPECIALIST' });
  const requestHeaders = new Headers(request.headers);
  const contentType = requestHeaders.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  const upstream = await fetch(target, { method, headers, ...(method === 'POST' ? { body: await request.arrayBuffer() } : {}), cache: 'no-store' });
  const responseHeaders = new Headers({ 'Cache-Control': 'no-store' });
  const upstreamType = upstream.headers.get('content-type');
  if (upstreamType) responseHeaders.set('content-type', upstreamType);
  const disposition = upstream.headers.get('content-disposition');
  if (disposition) responseHeaders.set('content-disposition', disposition);
  responseHeaders.set('X-Content-Type-Options', 'nosniff');
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
