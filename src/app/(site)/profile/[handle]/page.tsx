import type { Metadata } from 'next';
import { ProfileScreen } from '@/components/account';
export const metadata: Metadata = { title: 'Member profile' };
export default async function MemberProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return <ProfileScreen handle={handle}/>;
}
