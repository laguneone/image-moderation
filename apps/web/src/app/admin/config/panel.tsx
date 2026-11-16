'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type ConfigData = { models: Array<Record<string, unknown>>; pipelines: Array<Record<string, unknown>>; prompts: Array<Record<string, unknown>>; rules: Array<Record<string, unknown>> };

export function ConfigurationPanel({ userId }: { userId: string }): React.JSX.Element {
  const [data, setData] = useState<ConfigData | null>(null); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function load(): Promise<void> {
    setError('');
    try { const response = await fetch('/api/admin/configuration', { cache: 'no-store' }); const body: unknown = await response.json(); if (!response.ok) throw new Error(readError(body)); if (!isConfigData(body)) throw new Error('Ответ конфигурации имеет неверный формат.'); setData(body); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось загрузить настройки.'); }
  }
  useEffect(() => { void load(); }, []);
  async function submit(path: string, value: Record<string, unknown>): Promise<void> {
    setBusy(true); setError(''); setMessage('');
    try { const response = await fetch(`/api/admin/configuration${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }); const body: unknown = await response.json(); if (!response.ok) throw new Error(readError(body)); setMessage('Черновик сохранён. Опубликуйте версию после проверки.'); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить конфигурацию.'); }
    finally { setBusy(false); }
  }
  async function publish(kind: string, id: string): Promise<void> {
    setBusy(true); setError(''); setMessage('');
    try { const response = await fetch(`/api/admin/configuration/${kind}/${encodeURIComponent(id)}/publish`, { method: 'POST' }); const body: unknown = await response.json(); if (!response.ok) throw new Error(readError(body)); setMessage('Версия опубликована.'); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось опубликовать версию.'); }
    finally { setBusy(false); }
  }
  async function testPipeline(id: string): Promise<void> {
    setBusy(true); setError(''); setMessage('');
    try { const response = await fetch(`/api/admin/configuration/pipelines/${encodeURIComponent(id)}/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sample: { peoplePresent: true }, application_id: '' }) }); const body: unknown = await response.json(); if (!response.ok) throw new Error(readError(body)); setMessage(`Пробный запуск (без обращения к ИИ): ${JSON.stringify(body)}`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Пробный запуск не удался.'); }
    finally { setBusy(false); }
  }
  return <main className="admin-shell"><header className="admin-header"><div><p className="admin-eyebrow">Управление настройками</p><h1>Конфигурация модерации</h1></div><span>{userId}</span></header>
    <nav className="admin-nav"><Link href="/admin">Обзор</Link><Link href="/admin/moderations">История проверок</Link><Link aria-current="page" href="/admin/config">Конфигурация</Link></nav>
    {error && <p className="admin-error admin-alert" role="alert">{error}</p>}{message && <p className="admin-success">{message}</p>}
    <section className="admin-panel"><h2>Модели</h2><form className="config-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void submit('/models', { key: form.get('key'), name: form.get('name'), role: form.get('role'), openrouter_model_id: form.get('model'), timeout_ms: Number(form.get('timeout')), max_tokens: Number(form.get('max_tokens')) || undefined, structured_output: form.get('structured') === 'on' }); }}>
      <input name="key" placeholder="Ключ, например initial_scene" required maxLength={64} /><input name="name" placeholder="Название" required maxLength={120} /><input name="role" placeholder="Роль модели" required maxLength={64} /><input name="model" placeholder="OpenRouter model ID" required maxLength={200} /><input name="timeout" type="number" defaultValue="90000" min="1000" max="300000" /><input name="max_tokens" type="number" placeholder="Лимит токенов" min="1" max="32000" /><label><input name="structured" type="checkbox" /> JSON Schema</label><button className="admin-button" disabled={busy}>Создать черновик модели</button></form>
      <ConfigRows rows={data?.models ?? []} onPublish={(id) => void publish('model', id)} busy={busy} /></section>
    <section className="admin-panel"><h2>Версии конвейеров</h2><form className="config-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); let configuration: unknown; try { configuration = JSON.parse(String(form.get('configuration'))); } catch { setError('Конфигурация конвейера должна быть корректным JSON.'); return; } void submit('/pipelines', { pipeline_key: form.get('key'), name: form.get('name'), configuration }); }}><input name="key" defaultValue="interior-default" placeholder="Ключ конвейера" required /><input name="name" placeholder="Название версии" required /><textarea name="configuration" defaultValue={'{"deepAnalysis":true,"maxImageCrops":4}'} /><button className="admin-button" disabled={busy}>Создать черновик</button></form><ConfigRows rows={data?.pipelines ?? []} onPublish={(id) => void publish('pipeline', id)} onTest={(id) => void testPipeline(id)} busy={busy} /></section>
    <section className="admin-panel"><h2>Версии промптов</h2><form className="config-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void submit('/prompts', { key: form.get('key'), name: form.get('name'), model_role: form.get('role'), content: form.get('content') }); }}><input name="key" placeholder="Ключ шаблона" required /><input name="name" placeholder="Название" required /><input name="role" placeholder="Роль модели" required /><textarea name="content" placeholder="Текст промпта" required maxLength={20000} /><button className="admin-button" disabled={busy}>Создать черновик промпта</button></form><ConfigRows rows={data?.prompts ?? []} onPublish={(id) => void publish('prompt', id)} busy={busy} /></section>
    <section className="admin-panel"><h2>Версии правил</h2><form className="config-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); let conditions: unknown; let actions: unknown; try { conditions = JSON.parse(String(form.get('conditions'))); actions = JSON.parse(String(form.get('actions'))); } catch { setError('Условия и действия должны быть корректным JSON.'); return; } void submit('/rules', { key: form.get('key'), name: form.get('name'), priority: Number(form.get('priority')), conditions, actions }); }}><input name="key" placeholder="Ключ правила" required /><input name="name" placeholder="Название правила" required /><input name="priority" type="number" defaultValue="100" min="0" max="100000" /><textarea name="conditions" defaultValue={'{"field":"peoplePresent","operator":"EQUALS","value":true}'} /><textarea name="actions" defaultValue={'{"TRIGGER_STAGE":"deep_analysis"}'} /><button className="admin-button" disabled={busy}>Создать черновик правила</button></form><ConfigRows rows={data?.rules ?? []} onPublish={(id) => void publish('rule', id)} busy={busy} /></section>
  </main>;
}

function ConfigRows({ rows, onPublish, onTest, busy }: { rows: Array<Record<string, unknown>>; onPublish: (id: string) => void; onTest?: (id: string) => void; busy: boolean }): React.JSX.Element {
  return <div className="admin-stage-list">{rows.map((row) => { const id = typeof row.id === 'string' ? row.id : ''; const title = String(row.name ?? row.key ?? row.pipelineKey ?? 'Конфигурация'); return <article key={id}><div><strong>{title} · v{String(row.version ?? 1)}</strong><span>{String(row.status ?? '—')} · {String(row.openRouterModelId ?? row.pipelineKey ?? row.modelRole ?? row.key ?? '')}</span></div>{onTest && <button className="admin-button subtle" disabled={busy} onClick={() => onTest(id)}>Пробный запуск</button>}{row.status !== 'ACTIVE' && <button className="admin-button subtle" disabled={busy} onClick={() => onPublish(id)}>Опубликовать</button>}</article>; })}{rows.length === 0 && <p className="admin-muted">Версий пока нет.</p>}</div>;
}
function isConfigData(value: unknown): value is ConfigData { return isRecord(value) && ['models', 'pipelines', 'prompts', 'rules'].every((key) => Array.isArray(value[key])); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function readError(value: unknown): string { return isRecord(value) && typeof value.message === 'string' ? value.message : 'Запрос конфигурации завершился ошибкой.'; }
