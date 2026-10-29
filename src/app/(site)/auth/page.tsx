import type { Metadata } from 'next';
import { AuthScreen } from '@/components/account';
export const metadata: Metadata = { title: 'Join or sign in' };
export default function AuthPage() { return <AuthScreen/>; }
