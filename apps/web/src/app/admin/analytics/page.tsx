import type { ReactElement } from 'react';
import { AnalyticsPanel } from './panel';

export const dynamic = 'force-dynamic';
export default function AnalyticsPage(): ReactElement {
  return <AnalyticsPanel />;
}
