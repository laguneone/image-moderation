import type { ReactElement, ReactNode } from 'react';
import './globals.css';

export const metadata = { title: 'Image Moderation', description: 'AI/AR content moderation platform' };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>): ReactElement {
  return <html lang="ru"><body>{children}</body></html>;
}
