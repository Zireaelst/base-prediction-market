import { createPublicClient, getAddress, http, isAddress, parseAbi, type Address, type HttpTransport, type PublicClient } from 'viem';
import { baseSepolia } from 'viem/chains';
import { DomainError } from './errors';

export const predictionAbi = parseAbi([
  'function token() view returns (address)',
  'function feed() view returns (address)',
  'function feedDecimals() view returns (uint8)',
  'function marketCount() view returns (uint256)',
  'function markets(uint256) view returns (address creator, address opponent, uint256 stake, uint256 target, uint64 deadline, bool creatorAbove, uint8 status, uint256 price)',
  'function authorizations(address, address) view returns (uint256 maxPerTrade, uint256 remaining, uint64 expiresAt, uint256 epoch)',
  'function usedNonces(address, uint256) view returns (bool)',
  'function executeSwipe((address owner, address delegate, uint8 kind, uint256 marketId, uint256 target, uint64 deadline, uint256 stake, bool creatorAbove, uint256 nonce, uint64 validUntil, uint256 epoch) s, uint8 v, bytes32 r, bytes32 sigS) returns (uint256)',
]);
export const tokenAbi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address, address) view returns (uint256)',
]);
const feedAbi = parseAbi(['function description() view returns (string)']);

export function testnetConfig() {
  const contract = process.env.TESTNET_PREDICTION_ADDRESS;
  const token = process.env.TESTNET_TOKEN_ADDRESS;
  const rpc = process.env.BASE_SEPOLIA_RPC_URL;
  if (!contract || !isAddress(contract) || !token || !isAddress(token) || !rpc) throw new DomainError('Testnet is not configured', 503);
  let url: URL;
  try { url = new URL(rpc); } catch { throw new DomainError('Testnet is not configured', 503); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new DomainError('Testnet is not configured', 503);
  return { contract: getAddress(contract), token: getAddress(token), rpc };
}

export function testnetClient(rpc: string) {
  return createPublicClient({ chain: baseSepolia, transport: http(rpc, { timeout: 10_000, retryCount: 0 }) });
}

export async function assertDeployment(client: PublicClient<HttpTransport, typeof baseSepolia>, contract: Address, token: Address) {
  const [chain, code, tokenCode, configuredToken] = await Promise.all([
    client.getChainId(), client.getCode({ address: contract }), client.getCode({ address: token }),
    client.readContract({ address: contract, abi: predictionAbi, functionName: 'token' }),
  ]);
  if (chain !== baseSepolia.id || !code || code === '0x' || !tokenCode || tokenCode === '0x' || configuredToken.toLowerCase() !== token.toLowerCase()) {
    throw new DomainError('Invalid testnet deployment configuration', 503);
  }
}

export function safeTimestamp(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new DomainError('Testnet timestamp cannot be represented', 503);
  return Number(value);
}

export async function getTestnetMarkets() {
  const { contract, token, rpc } = testnetConfig();
  const client = testnetClient(rpc);
  await assertDeployment(client, contract, token);
  const block = await client.getBlock();
  const blockNumber = block.number;
  const [count, feedDecimals, feed] = await Promise.all([
    client.readContract({ address: contract, abi: predictionAbi, functionName: 'marketCount', blockNumber }),
    client.readContract({ address: contract, abi: predictionAbi, functionName: 'feedDecimals', blockNumber }),
    client.readContract({ address: contract, abi: predictionAbi, functionName: 'feed', blockNumber }),
  ]);
  const feedDescription = await client.readContract({ address: feed, abi: feedAbi, functionName: 'description', blockNumber });
  const length = Number(count < 100n ? count : 100n);
  const markets = await Promise.all(Array.from({ length }, async (_, index) => {
    const id = count - BigInt(index);
    const [creator, opponent, stake, target, deadline, creatorAbove, status, price] = await client.readContract({ address: contract, abi: predictionAbi, functionName: 'markets', args: [id], blockNumber });
    return { id: id.toString(), creator, opponent, stake: stake.toString(), target: target.toString(), deadline: safeTimestamp(deadline), creatorAbove, status, price: price.toString() };
  }));
  return { chainId: baseSepolia.id, contract, token, feed, feedDescription, feedDecimals, markets };
}
