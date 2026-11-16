import type { ReactElement } from 'react';
import { AdminLoginForm } from './login-form';

export default function AdminLoginPage(): ReactElement {
  return <main className="admin-auth-shell"><section className="admin-auth-card">
    <p className="admin-eyebrow">NSFW Filter · администрирование</p><h1>Вход в панель</h1>
    <p className="admin-muted">Доступ разрешён только учётным записям из серверной конфигурации.</p>
    <AdminLoginForm />
  </section></main>;
}
