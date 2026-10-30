import type { Metadata } from 'next';
import { AuthScreen } from '@/components/account';
import { privyConfig } from '@/lib/server/privy-auth';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Join or sign in' };
export default function AuthPage() { return <AuthScreen privyAppId={privyConfig()?.appId ?? null}/>; }
