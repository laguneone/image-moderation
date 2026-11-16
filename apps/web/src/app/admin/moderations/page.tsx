import type { ReactElement } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_COOKIE, verifyAdminToken } from '../../../lib/admin-auth';
import { ModerationHistory } from './history';

export const dynamic = 'force-dynamic';

export default async function ModerationHistoryPage(): Promise<ReactElement> {
  const session = verifyAdminToken((await cookies()).get(ADMIN_COOKIE)?.value);
  if (!session) redirect('/admin/login');
  return <ModerationHistory role={session.role} />;
}
