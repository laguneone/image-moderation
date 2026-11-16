import type { ReactElement } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_COOKIE, verifyAdminToken } from '../../lib/admin-auth';
import { AdminOverview } from './overview';

export const dynamic = 'force-dynamic';

export default async function AdminPage(): Promise<ReactElement> {
  const session = verifyAdminToken((await cookies()).get(ADMIN_COOKIE)?.value);
  if (!session) redirect('/admin/login');
  return <AdminOverview userId={session.id} role={session.role} />;
}
