import type { ReactElement } from 'react';
import { ModerationDetail } from './detail';

export const dynamic = 'force-dynamic';

export default async function ModerationDetailPage({ params }: { params: Promise<{ id: string }> }): Promise<ReactElement> {
  const { id } = await params;
  return <ModerationDetail id={id} userId="local-admin" role="SPECIALIST" />;
}
