import type { ReactElement } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_COOKIE, verifyAdminToken } from '../../../../lib/admin-auth';
import { ModerationDetail } from './detail';

export const dynamic = 'force-dynamic';

export default async function ModerationDetailPage({ params }: { params: Promise<{ id: string }> }): Promise<ReactElement> {
  const session = verifyAdminToken((await cookies()).get(ADMIN_COOKIE)?.value);
  if (!session) redirect('/admin/login');
  const { id } = await params;
  return <ModerationDetail id={id} userId={session.id} role={session.role} />;
}
