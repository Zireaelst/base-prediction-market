import type { Metadata } from 'next';
import { RoomScreen } from '@/components/rooms';
export const metadata: Metadata = { title: 'Room' };
export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RoomScreen id={id}/>;
}
