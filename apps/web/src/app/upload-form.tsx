'use client';

import { FormEvent, useRef, useState } from 'react';

interface UploadResult {
  job_id?: string;
  status?: string;
  error?: unknown;
  image?: { width: number; height: number; mime_type: string; size_bytes: number };
  decision?: string | null;
  result?: { nsfw_risk_score: number; domain_mismatch_score: number; confidence: number | null; reasons: unknown; critical_flags: unknown } | null;
}

export function UploadForm(): React.JSX.Element {
  const [result, setResult] = useState<UploadResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const idempotencyKey = useRef('');

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setMessage(null);
    setResult(null);
    setIsSubmitting(true);

    try {
      const form = event.currentTarget;
      if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
      const data = new FormData(form);
      data.set('idempotency_key', idempotencyKey.current);
      const response = await fetch('/api/moderations', { method: 'POST', body: data });
      const body = (await response.json()) as UploadResult;
      idempotencyKey.current = crypto.randomUUID();
      if (!response.ok) {
        setMessage(errorMessage(body.error));
        return;
      }
      setResult(body);
    } catch {
      setMessage('Не удалось связаться с сервером. Проверьте, что проект запущен.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function refreshStatus(): Promise<void> {
    if (!result?.job_id) return;
    setMessage(null);
    try {
      const response = await fetch(`/api/moderations?id=${encodeURIComponent(result.job_id)}`, { cache: 'no-store' });
      const body = (await response.json()) as UploadResult;
      if (!response.ok) {
        setMessage(errorMessage(body.error));
        return;
      }
      setResult(body);
    } catch {
      setMessage('Не удалось обновить статус задачи.');
    }
  }

  return (
    <>
      <form className="upload-form" onSubmit={submit}>
        <label htmlFor="image">Изображение</label>
        <input id="image" name="file" type="file" accept="image/jpeg,image/png,image/webp" required />

        <label htmlFor="application">Идентификатор приложения</label>
        <input id="application" name="application_id" defaultValue="local" maxLength={64} required />

        <label htmlFor="pipeline">Pipeline</label>
        <input id="pipeline" name="pipeline" defaultValue="interior-default" maxLength={100} />

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Загрузка…' : 'Загрузить и поставить в очередь'}
        </button>
      </form>

      {message && <p className="message error" role="alert">{message}</p>}
      {result?.job_id && (
        <section className="result" aria-live="polite">
          <h2>Задача создана</h2>
          <dl>
            <div><dt>ID</dt><dd>{result.job_id}</dd></div>
            <div><dt>Статус</dt><dd>{result.status}</dd></div>
            {result.image && <div><dt>Размер</dt><dd>{result.image.width} × {result.image.height} · {result.image.mime_type}</dd></div>}
            {result.decision && <div><dt>Решение</dt><dd>{result.decision}</dd></div>}
            {result.result && <>
              <div><dt>Риск NSFW</dt><dd>{result.result.nsfw_risk_score} / 100</dd></div>
              <div><dt>Несоответствие тематике</dt><dd>{result.result.domain_mismatch_score} / 100</dd></div>
              <div><dt>Причины</dt><dd>{renderList(result.result.reasons)}</dd></div>
            </>}
          </dl>
          <button type="button" className="secondary" onClick={refreshStatus}>Обновить статус</button>
        </section>
      )}
    </>
  );
}

function renderList(value: unknown): string {
  if (!Array.isArray(value)) return 'Нет дополнительных сведений';
  const items = value.filter((item): item is string => typeof item === 'string');
  return items.length > 0 ? items.join(' ') : 'Нет дополнительных сведений';
}

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value.join(' ');
  }
  return 'Не удалось загрузить изображение.';
}
