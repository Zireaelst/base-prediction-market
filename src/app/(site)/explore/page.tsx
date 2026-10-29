import type { Metadata } from 'next';
import { ExploreScreen } from '@/components/discover';
export const metadata: Metadata = { title: 'Explore markets' };
export default function ExplorePage() { return <ExploreScreen/>; }
