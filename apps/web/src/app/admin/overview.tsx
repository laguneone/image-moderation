'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Dashboard {
  total: number; completed: number; approved: number; rejected: number; review: number; errors: number;
  average_nsfw_risk: number | null; average_duration_ms: number | null; openrouter_cost_usd: number; model_calls: number;
  detected_people: number; deep_analysis_runs: number; queue: { waiting: number; active: number; delayed: number };
}
export interface JobRow {
  job_id: string; status: string; application_id: string; mime_type: string; nsfw_risk_score: number | null; domain_mismatch_score: number | null;
  decision: string | null; pipeline: string; created_at: string; ai_cost_usd: number; duration_ms: number | null;
  preview_allowed: boolean;
}

export function AdminOverview({ userId, role }: { userId: string; role: 'ADMIN' | 'SPECIALIST' }): React.JSX.Element {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  async function load(): Promise<void> {
    setBusy(true); setError(null);
    try {
      const [dashboardResponse, jobsResponse] = await Promise.all([fetch('/api/admin/dashboard', { cache: 'no-store' }), fetch('/api/admin/moderations?page=1&page_size=10', { cache: 'no-store' })]);
      const dashboardBody: unknown = await dashboardResponse.json();
      const jobsBody: unknown = await jobsResponse.json();
      if (!dashboardResponse.ok || !jobsResponse.ok) throw new Error(readError(!dashboardResponse.ok ? dashboardBody : jobsBody));
      if (!isDashboard(dashboardBody) || !isJobList(jobsBody)) throw new Error('Сервер вернул некорректный формат данных.');
      setDashboard(dashboardBody); setJobs(jobsBody.items);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Ошибка загрузки панели.'); }
    finally { setBusy(false); }
  }

  useEffect(() => { void load(); }, []);

  async function logout(): Promise<void> {
    await fetch('/api/admin/session', { method: 'DELETE' });
    window.location.assign('/admin/login');
  }

  return <main className="admin-shell">
    <header className="admin-header"><div><p className="admin-eyebrow">NSFW Filter</p><h1>Панель модерации</h1></div><div className="admin-account"><span>{userId} · {role === 'SPECIALIST' ? 'специалист' : 'администратор'}</span><button className="admin-button subtle" onClick={logout}>Выйти</button></div></header>
    <nav className="admin-nav"><Link aria-current="page" href="/admin">Обзор</Link><Link href="/admin/moderations">История проверок</Link><Link href="/">Загрузить изображение</Link></nav>
    {error && <p className="admin-error admin-alert" role="alert">{error}</p>}
    {busy && !dashboard ? <p className="admin-muted">Загружаем данные…</p> : dashboard && <>
      <section className="admin-kpis">
        <Metric label="Всего задач" value={dashboard.total} /><Metric label="Обработано" value={dashboard.completed} /><Metric label="Одобрено" value={dashboard.approved} />
        <Metric label="Отклонено" value={dashboard.rejected} /><Metric label="На проверке" value={dashboard.review} /><Metric label="Ошибки" value={dashboard.errors} />
        <Metric label="Средний NSFW риск" value={dashboard.average_nsfw_risk === null ? '—' : `${dashboard.average_nsfw_risk} / 100`} />
        <Metric label="Время обработки" value={dashboard.average_duration_ms === null ? '—' : `${(dashboard.average_duration_ms / 1000).toFixed(1)} с`} />
        <Metric label="Расход OpenRouter" value={`$${dashboard.openrouter_cost_usd.toFixed(4)}`} />
        <Metric label="Вызовы моделей" value={dashboard.model_calls} /><Metric label="Обнаружено людей" value={dashboard.detected_people} />
        <Metric label="Глубокий анализ" value={dashboard.deep_analysis_runs} /><Metric label="Очередь" value={`${dashboard.queue.waiting} ожид. · ${dashboard.queue.active} актив.`} />
      </section>
      <section className="admin-panel"><div className="admin-section-heading"><div><p className="admin-eyebrow">Последние поступления</p><h2>Проверки</h2></div><button className="admin-button subtle" onClick={() => void load()}>Обновить</button></div>
        <JobTable jobs={jobs} role={role} />
      </section>
    </>}
  </main>;
}

export function JobTable({ jobs, role = 'ADMIN' }: { jobs: JobRow[]; role?: 'ADMIN' | 'SPECIALIST' }): React.JSX.Element {
  if (jobs.length === 0) return <p className="admin-muted">Пока нет проверок.</p>;
  return <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Фото</th><th>ID</th><th>Приложение</th><th>Тип</th><th>NSFW</th><th>Тема</th><th>Решение</th><th>Pipeline</th><th>Стоимость</th><th>Время</th></tr></thead><tbody>
    {jobs.map((job) => <tr key={job.job_id}><td>{job.preview_allowed || role === 'SPECIALIST' ? <Link href={`/admin/moderations/${encodeURIComponent(job.job_id)}`}><img className="admin-thumb" src={`/api/admin/moderations/${encodeURIComponent(job.job_id)}/image`} alt="Предпросмотр" /></Link> : 'ограничен'}</td><td><Link href={`/admin/moderations/${encodeURIComponent(job.job_id)}`}>{job.job_id.slice(0, 12)}</Link></td><td>{job.application_id}</td><td>{job.mime_type}</td><td>{job.nsfw_risk_score ?? '—'}</td><td>{job.domain_mismatch_score ?? '—'}</td><td><Decision value={job.decision} /></td><td>{job.pipeline}</td><td>{job.ai_cost_usd > 0 ? `$${job.ai_cost_usd.toFixed(4)}` : '—'}</td><td>{new Date(job.created_at).toLocaleString('ru-RU')}</td></tr>)}
  </tbody></table></div>;
}

function Metric({ label, value }: { label: string; value: string | number }): React.JSX.Element { return <article className="admin-metric"><span>{label}</span><strong>{value}</strong></article>; }
export function Decision({ value }: { value: string | null }): React.JSX.Element { return <span className={`admin-decision decision-${(value ?? 'pending').toLowerCase()}`}>{value ?? 'В очереди'}</span>; }
function isDashboard(value: unknown): value is Dashboard { return isRecord(value) && typeof value.total === 'number' && typeof value.completed === 'number' && isRecord(value.queue); }
function isJobList(value: unknown): value is { items: JobRow[] } { return isRecord(value) && Array.isArray(value.items); }
function readError(value: unknown): string { return isRecord(value) && typeof value.message === 'string' ? value.message : isRecord(value) && typeof value.error === 'string' ? value.error : 'Не удалось загрузить данные.'; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
