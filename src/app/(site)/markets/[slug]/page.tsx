import type { Metadata } from 'next';
import { MarketScreen } from '@/components/market-detail';
import { MarketAnalysis } from '@/components/market-analysis';
export const metadata: Metadata = { title: 'Market snapshot' };
export default async function MarketPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <><MarketScreen slug={slug}/><MarketAnalysis slug={slug}/></>;
}
