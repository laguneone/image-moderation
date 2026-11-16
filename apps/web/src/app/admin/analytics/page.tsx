import type { ReactElement } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_COOKIE, verifyAdminToken } from '../../../lib/admin-auth';
import { AnalyticsPanel } from './panel';

export const dynamic = 'force-dynamic';
export default async function AnalyticsPage(): Promise<ReactElement> {
  const session = verifyAdminToken((await cookies()).get(ADMIN_COOKIE)?.value);
  if (!session) redirect('/admin/login');
  if (session.role !== 'ADMIN') redirect('/admin');
  return <AnalyticsPanel />;
}
