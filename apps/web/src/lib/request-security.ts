export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;

  try {
    const requestUrl = new URL(request.url);
    const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
    const host = forwardedHost || request.headers.get('host') || requestUrl.host;
    const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const protocol = forwardedProtocol || requestUrl.protocol.slice(0, -1);
    const expectedOrigin = new URL(`${protocol}://${host}`).origin;
    const originUrl = new URL(origin);

    return (originUrl.protocol === 'http:' || originUrl.protocol === 'https:')
      && originUrl.origin === expectedOrigin;
  } catch {
    return false;
  }
}
