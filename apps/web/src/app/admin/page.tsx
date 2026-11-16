import type { ReactElement } from 'react';
import { AdminOverview } from './overview';

export const dynamic = 'force-dynamic';

export default function AdminPage(): ReactElement {
  return <AdminOverview role="ADMIN" />;
}
