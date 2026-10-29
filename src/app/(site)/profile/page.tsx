import type { Metadata } from 'next';
import { ProfileScreen } from '@/components/account';
export const metadata: Metadata = { title: 'Profile' };
export default function ProfilePage() { return <ProfileScreen/>; }
