import type { ReactElement } from 'react';
import { ConfigurationPanel } from './panel';

export const dynamic = 'force-dynamic';
export default function ConfigurationPage(): ReactElement {
  return <ConfigurationPanel userId="local-admin" />;
}
