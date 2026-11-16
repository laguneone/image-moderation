import type { ReactElement } from 'react';
import { ModerationHistory } from './history';

export const dynamic = 'force-dynamic';

export default function ModerationHistoryPage(): ReactElement {
  return <ModerationHistory role="SPECIALIST" />;
}
