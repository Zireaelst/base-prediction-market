import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { GeistPixelSquare } from 'geist/font/pixel';
import type { Metadata } from 'next';
import { SessionProvider } from '@/components/api';
import { Shell } from '@/components/ui';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'PREDICT. — Future thinking', template: '%s | PREDICT.' },
  description: 'Think in probabilities. Explore real venue questions, share forecasts in rooms, and try local paper simulations. No real-money trading.',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} ${GeistPixelSquare.variable}`}><body><SessionProvider><Shell>{children}</Shell></SessionProvider></body></html>;
}
