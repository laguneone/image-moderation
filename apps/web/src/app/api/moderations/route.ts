export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const apiUrl = process.env.API_INTERNAL_URL;
  const apiKey = process.env.UPLOAD_API_KEY?.trim();
  if (!apiUrl || !apiKey) {
    return Response.json({ error: 'Загрузка отключена: настройте API_INTERNAL_URL и UPLOAD_API_KEY.' }, { status: 503 });
  }

  const incoming = await request.formData();
  const file = incoming.get('file');
  if (!(file instanceof File)) return Response.json({ error: 'Выберите файл изображения.' }, { status: 400 });

  const outgoing = new FormData();
  outgoing.append('file', file, file.name);
  const headers = new Headers({
    'x-api-key': apiKey,
    'x-application-id': stringField(incoming.get('application_id')) || 'local',
    'x-pipeline': stringField(incoming.get('pipeline')) || 'interior-default',
    'idempotency-key': stringField(incoming.get('idempotency_key')) || crypto.randomUUID(),
  });
  const context = stringField(incoming.get('context'));
  if (context) headers.set('x-context', context);

  const upstream = await fetch(`${apiUrl}/api/v1/moderations`, {
    method: 'POST',
    headers,
    body: outgoing,
    cache: 'no-store',
  });
  return forwardResponse(upstream);
}

export async function GET(request: Request): Promise<Response> {
  const apiUrl = process.env.API_INTERNAL_URL;
  const apiKey = process.env.UPLOAD_API_KEY?.trim();
  const id = new URL(request.url).searchParams.get('id');
  if (!id || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return Response.json({ error: 'Некорректный ID задачи.' }, { status: 400 });
  if (!apiUrl || !apiKey) return Response.json({ error: 'API status lookup is not configured.' }, { status: 503 });

  const upstream = await fetch(`${apiUrl}/api/v1/moderations/${encodeURIComponent(id)}`, {
    headers: { 'x-api-key': apiKey },
    cache: 'no-store',
  });
  return forwardResponse(upstream);
}

function stringField(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value : '';
}

async function forwardResponse(upstream: Response): Promise<Response> {
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
