'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { Decision, JobStatus } from '../../overview';

interface Detail {
  job_id: string; status: string; application_id: string; pipeline: string; created_at: string; effective_decision: string | null;
  review_assignee_id: string | null; review_version: number;
  image: { mime_type: string; size_bytes: number; width: number; height: number; sha256: string };
  result: { nsfw_risk_score: number; domain_mismatch_score: number; decision: string; confidence: number | null; reasons: unknown; critical_flags: unknown; details: unknown } | null;
  stages: Array<{ id: string; stageType: string; status: string; durationMs: number | null; modelId: string | null; normalizedOutput: unknown; error: string | null }>;
  invocations: Array<{ id: string; modelId: string; provider: string | null; inputTokens: number | null; outputTokens: number | null; costUsd: string | null; latencyMs: number; status: string }>;
  review_decisions: Array<{ id: string; actorId: string; action: string; rejectionReason: string | null; comment: string | null; createdAt: string }>;
  audit: Array<{ id: string; actorId: string | null; action: string; createdAt: string; before: unknown; after: unknown }>;
}

export function ModerationDetail({ id, userId, role }: { id: string; userId: string; role: 'ADMIN' | 'SPECIALIST' }): React.JSX.Element {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('EXPLICIT_CONTENT');
  const [comment, setComment] = useState('');

  async function load(): Promise<void> {
    setError(null);
    try {
      const response = await fetch(`/api/admin/moderations/${encodeURIComponent(id)}`, { cache: 'no-store' });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(body));
      if (!isDetail(body)) throw new Error('Сервер вернул некорректные данные проверки.');
      setDetail(body);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось загрузить карточку.'); }
  }

  useEffect(() => {
    void load();
    const isActive = !detail || ['queued', 'processing'].includes(detail.status.toLowerCase());
    if (!isActive) return;
    const timer = window.setInterval(() => { void load(); }, 3_000);
    return () => window.clearInterval(timer);
  }, [id, detail?.status]);

  async function claim(): Promise<void> {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/admin/moderations/${encodeURIComponent(id)}/claim`, { method: 'POST' });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(body));
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось закрепить проверку.'); }
    finally { setBusy(false); }
  }

  async function decide(action: 'APPROVED' | 'REJECTED', event?: FormEvent<HTMLFormElement>): Promise<void> {
    event?.preventDefault(); if (!detail) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/admin/moderations/${encodeURIComponent(id)}/decision`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, reason: action === 'REJECTED' ? reason : undefined, comment, review_version: detail.review_version }) });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(body));
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить решение.'); }
    finally { setBusy(false); }
  }

  return <main className="admin-shell">
    <header className="admin-header"><div><p className="admin-eyebrow">Карточка проверки</p><h1>{id}</h1></div><Link className="admin-button subtle" href="/admin/moderations">К истории</Link></header>
    {error && <p className="admin-error admin-alert" role="alert">{error}</p>}
    {!detail && !error && <p className="admin-muted">Загружаем карточку…</p>}
    {detail && <>
      <section className="admin-detail-grid">
        <article className="admin-panel admin-image-panel"><img src={`/api/admin/moderations/${encodeURIComponent(id)}/image`} alt="Проверяемое изображение" />
          <dl className="admin-facts"><Fact label="Формат" value={detail.image.mime_type} /><Fact label="Размер" value={`${detail.image.width} × ${detail.image.height} · ${formatBytes(detail.image.size_bytes)}`} /><Fact label="SHA-256" value={detail.image.sha256} /></dl>
        </article>
        <article className="admin-panel"><p className="admin-eyebrow">Статус задачи</p><div className="admin-score-heading"><h2><JobStatus value={detail.status} /></h2><span>Решение: <Decision value={detail.effective_decision ?? detail.result?.decision ?? null} /></span></div>
          {detail.result && <div className="admin-score-grid"><Fact label="NSFW Risk" value={`${detail.result.nsfw_risk_score} / 100`} /><Fact label="Domain Mismatch" value={`${detail.result.domain_mismatch_score} / 100`} /><Fact label="Уверенность" value={detail.result.confidence === null ? 'не указана' : String(detail.result.confidence)} /></div>}
          <Fact label="Приложение" value={detail.application_id} /><Fact label="Pipeline" value={detail.pipeline} /><Fact label="Создано" value={new Date(detail.created_at).toLocaleString('ru-RU')} />
          <h3>Причины</h3><p>{detail.result ? listText(detail.result.reasons) : 'Результат ещё не готов.'}</p>
          {detail.result && <><h3>Модельные результаты и метаданные</h3><pre className="admin-json">{JSON.stringify(detail.result.details, null, 2)}</pre></>}
        </article>
      </section>
      {detail.result && ['REVIEW', 'CRITICAL_REVIEW'].includes(detail.result.decision) && !detail.effective_decision && <section className="admin-panel admin-review-panel"><p className="admin-eyebrow">Ручная модерация</p><h2>{detail.review_assignee_id ? `Назначено: ${detail.review_assignee_id}` : 'Возьмите проверку в работу'}</h2>
        {!detail.review_assignee_id && <button className="admin-button" disabled={busy} onClick={() => void claim()}>Взять проверку</button>}
        {detail.review_assignee_id === userId && <form className="admin-form review-form" onSubmit={(event) => void decide('REJECTED', event)}>
          <label>Причина отклонения<select value={reason} onChange={(event) => setReason(event.target.value)}><option value="EXPLICIT_CONTENT">Явный контент</option><option value="SEXUALIZED_CONTENT">Сексуализированный контент</option><option value="DOMAIN_MISMATCH">Не соответствует тематике</option><option value="UNSUPPORTED_CONTENT">Неподдерживаемый контент</option><option value="POLICY_VIOLATION">Нарушение политики</option><option value="OTHER">Другое</option></select></label>
          <label>Комментарий<textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={2000} rows={3} /></label>
          <div className="admin-actions"><button type="button" disabled={busy} onClick={() => void decide('APPROVED')}>Одобрить</button><button className="danger" disabled={busy}>Отклонить</button></div>
        </form>}
        {detail.review_assignee_id && detail.review_assignee_id !== userId && <p className="admin-warning">Проверка назначена сотруднику {detail.review_assignee_id}.</p>}
        {detail.result.decision === 'CRITICAL_REVIEW' && role !== 'SPECIALIST' && <p className="admin-warning">Для разрешения критической проверки нужна учётная запись специалиста.</p>}
      </section>}
      <section className="admin-panel"><h2>Этапы проверки</h2><div className="admin-stage-list">{detail.stages.map((stage) => <article key={stage.id}><div><strong>{stage.stageType}</strong><span>{stage.modelId ?? 'локальный этап'} · {stage.status} · {stage.durationMs ?? '—'} мс</span></div>{stage.error && <p className="admin-error">{stage.error}</p>}<pre className="admin-json">{JSON.stringify(stage.normalizedOutput, null, 2)}</pre></article>)}</div></section>
      <section className="admin-panel"><h2>Вызовы моделей</h2><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Модель</th><th>Провайдер</th><th>Токены</th><th>Время</th><th>Стоимость</th><th>Статус</th></tr></thead><tbody>{detail.invocations.map((call) => <tr key={call.id}><td>{call.modelId}</td><td>{call.provider ?? '—'}</td><td>{call.inputTokens ?? '—'} / {call.outputTokens ?? '—'}</td><td>{call.latencyMs} мс</td><td>{call.costUsd ? `$${call.costUsd}` : '—'}</td><td>{call.status}</td></tr>)}</tbody></table></div></section>
      <section className="admin-panel"><h2>Решения и аудит</h2><div className="admin-stage-list">{detail.review_decisions.map((item) => <article key={item.id}><strong>{item.action} · {item.actorId}</strong><span>{new Date(item.createdAt).toLocaleString('ru-RU')} · {item.rejectionReason ?? '—'} · {item.comment ?? ''}</span></article>)}{detail.audit.map((item) => <article key={item.id}><strong>{item.action}</strong><span>{new Date(item.createdAt).toLocaleString('ru-RU')} · {item.actorId ?? 'система'}</span></article>)}{detail.review_decisions.length === 0 && detail.audit.length === 0 && <p className="admin-muted">Записей аудита пока нет.</p>}</div></section>
    </>}
  </main>;
}

function Fact({ label, value }: { label: string; value: string }): React.JSX.Element { return <div className="admin-fact"><dt>{label}</dt><dd>{value}</dd></div>; }
function listText(value: unknown): string { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').join(' ') || 'Нет дополнительных сведений.' : 'Нет дополнительных сведений.'; }
function formatBytes(value: number): string { return value < 1_000_000 ? `${(value / 1_000).toFixed(0)} KB` : `${(value / 1_000_000).toFixed(2)} MB`; }
function errorMessage(value: unknown): string { return isRecord(value) && typeof value.message === 'string' ? value.message : isRecord(value) && typeof value.error === 'string' ? value.error : 'Не удалось загрузить данные.'; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isDetail(value: unknown): value is Detail { return isRecord(value) && typeof value.job_id === 'string' && isRecord(value.image) && Array.isArray(value.stages); }
