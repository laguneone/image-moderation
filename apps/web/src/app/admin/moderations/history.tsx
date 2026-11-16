'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { JobRow, JobTable } from '../overview';

export function ModerationHistory({ role }: { role: 'ADMIN' | 'SPECIALIST' }): React.JSX.Element {
  const [rows, setRows] = useState<JobRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [decision, setDecision] = useState('');
  const [status, setStatus] = useState('');
  const [applicationId, setApplicationId] = useState('');
  const [pipeline, setPipeline] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load(event?: FormEvent<HTMLFormElement>): Promise<void> {
    event?.preventDefault(); setError(null);
    const params = new URLSearchParams({ page: String(event ? 1 : page), page_size: '25' });
    if (search.trim()) params.set('search', search.trim());
    if (decision) params.set('decision', decision);
    if (status) params.set('status', status);
    if (applicationId.trim()) params.set('application_id', applicationId.trim());
    if (pipeline.trim()) params.set('pipeline', pipeline.trim());
    if (from) params.set('from', new Date(from).toISOString());
    if (to) params.set('to', new Date(`${to}T23:59:59.999`).toISOString());
    try {
      const response = await fetch(`/api/admin/moderations?${params}`, { cache: 'no-store' });
      const result: unknown = await response.json();
      if (!response.ok) throw new Error(errorText(result));
      if (!isRecord(result) || !Array.isArray(result.items) || typeof result.total !== 'number') throw new Error('Сервер вернул некорректный формат данных.');
      setRows(result.items as JobRow[]); setTotal(result.total);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось загрузить историю.'); }
  }

  useEffect(() => { void load(); }, [page, decision]);

  return <main className="admin-shell">
    <header className="admin-header"><div><p className="admin-eyebrow">Архив модерации</p><h1>История проверок</h1></div><Link className="admin-button subtle" href="/admin">Обзор</Link></header>
    <form className="admin-filter" onSubmit={(event) => { setPage(1); void load(event); }}>
      <label>Поиск по ID или приложению<input value={search} onChange={(event) => setSearch(event.target.value)} maxLength={128} /></label>
      <label>Решение<select value={decision} onChange={(event) => { setDecision(event.target.value); setPage(1); }}><option value="">Все решения</option><option>ALLOW</option><option>REVIEW</option><option>RESTRICT</option><option>CRITICAL_REVIEW</option><option>APPROVED</option><option>REJECTED</option></select></label>
      <label>Статус<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">Все статусы</option><option value="QUEUED">В очереди</option><option value="PROCESSING">Обработка</option><option value="COMPLETED">Завершено</option><option value="FAILED">Ошибка</option></select></label>
      <label>Приложение<input value={applicationId} onChange={(event) => setApplicationId(event.target.value)} maxLength={64} /></label>
      <label>Pipeline<input value={pipeline} onChange={(event) => setPipeline(event.target.value)} maxLength={100} /></label>
      <label>С даты<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>По дату<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <button className="admin-button">Искать</button>
    </form>
    {error && <p className="admin-error admin-alert">{error}</p>}
    <section className="admin-panel"><JobTable jobs={rows} role={role} /><div className="admin-pagination"><button className="admin-button subtle" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Назад</button><span>Страница {page} · всего {total}</span><button className="admin-button subtle" disabled={page * 25 >= total} onClick={() => setPage((current) => current + 1)}>Далее</button></div></section>
  </main>;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function errorText(value: unknown): string { return isRecord(value) && typeof value.message === 'string' ? value.message : isRecord(value) && typeof value.error === 'string' ? value.error : 'Ошибка запроса.'; }
