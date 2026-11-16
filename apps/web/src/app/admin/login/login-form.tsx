'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

export function AdminLoginForm(): React.JSX.Element {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setBusy(true); setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/admin/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: form.get('id'), password: form.get('password') }) });
      const body: unknown = await response.json();
      if (!response.ok) { setError(readError(body)); return; }
      router.replace('/admin'); router.refresh();
    } catch { setError('Не удалось подключиться к серверу.'); }
    finally { setBusy(false); }
  }

  return <form className="admin-form" onSubmit={submit}>
    <label htmlFor="admin-id">Логин</label><input id="admin-id" name="id" autoComplete="username" maxLength={64} required />
    <label htmlFor="admin-password">Пароль</label><input id="admin-password" name="password" type="password" autoComplete="current-password" maxLength={256} required />
    {error && <p className="admin-error" role="alert">{error}</p>}
    <button disabled={busy}>{busy ? 'Проверка…' : 'Войти'}</button>
  </form>;
}

function readError(value: unknown): string {
  if (typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string') return (value as { error: string }).error;
  return 'Не удалось выполнить вход.';
}
