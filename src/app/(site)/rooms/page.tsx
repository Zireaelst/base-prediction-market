import type { Metadata } from 'next';
import { RoomsScreen } from '@/components/rooms';
export const metadata: Metadata = { title: 'Rooms' };
export default function RoomsPage() { return <RoomsScreen/>; }
