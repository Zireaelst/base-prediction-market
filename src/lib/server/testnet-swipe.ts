import { getAddress, hashTypedData, isAddress, recoverTypedDataAddress, type Address, type Hex } from 'viem';
import { baseSepolia } from 'viem/chains';
import { DomainError } from './errors';

export interface Swipe {
  owner: Address;
  delegate: Address;
  kind: 1;
  marketId: bigint;
  target: bigint;
  deadline: bigint;
  stake: bigint;
  creatorAbove: false;
  nonce: bigint;
  validUntil: bigint;
  epoch: bigint;
}

const fields = ['owner', 'delegate', 'kind', 'marketId', 'target', 'deadline', 'stake', 'creatorAbove', 'nonce', 'validUntil', 'epoch'];
const uint256Max = (1n << 256n) - 1n;
const halfOrder = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
const swipeTypes = { Swipe: [
  { name: 'owner', type: 'address' }, { name: 'delegate', type: 'address' },
  { name: 'kind', type: 'uint8' }, { name: 'marketId', type: 'uint256' },
  { name: 'target', type: 'uint256' }, { name: 'deadline', type: 'uint64' },
  { name: 'stake', type: 'uint256' }, { name: 'creatorAbove', type: 'bool' },
  { name: 'nonce', type: 'uint256' }, { name: 'validUntil', type: 'uint64' },
  { name: 'epoch', type: 'uint256' },
] } as const;

function invalid(): never { throw new DomainError('Invalid signed swipe', 400); }
function integer(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value)) return invalid();
  const parsed = BigInt(value);
  if (parsed > uint256Max) return invalid();
  return parsed;
}
function address(value: unknown): Address {
  if (typeof value !== 'string' || !isAddress(value)) return invalid();
  const result = getAddress(value);
  if (result === '0x0000000000000000000000000000000000000000') return invalid();
  return result;
}

export async function validateSwipe(body: Record<string, unknown>, walletAddress: string, contract: Address) {
  if (Object.keys(body).length !== 2 || !('swipe' in body) || !('signature' in body)) return invalid();
  const raw = body.swipe;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid();
  const s = raw as Record<string, unknown>;
  if (Object.keys(s).length !== fields.length || fields.some(field => !(field in s))) return invalid();
  if (s.kind !== 1 || s.target !== '0' || s.deadline !== 0 || s.creatorAbove !== false || typeof s.validUntil !== 'number' || !Number.isSafeInteger(s.validUntil) || s.validUntil < 0) return invalid();
  const swipe: Swipe = {
    owner: address(s.owner), delegate: address(s.delegate), kind: 1,
    marketId: integer(s.marketId), target: 0n, deadline: 0n, stake: integer(s.stake),
    creatorAbove: false, nonce: integer(s.nonce), validUntil: BigInt(s.validUntil), epoch: integer(s.epoch),
  };
  if (swipe.owner.toLowerCase() !== walletAddress.toLowerCase()) throw new DomainError('Wallet session does not match swipe owner', 403);
  if (swipe.owner === swipe.delegate || swipe.marketId === 0n || swipe.stake === 0n) return invalid();
  if (typeof body.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(body.signature)) return invalid();
  const signature = body.signature as Hex;
  const r = `0x${signature.slice(2, 66)}` as Hex;
  const sigS = `0x${signature.slice(66, 130)}` as Hex;
  const v = Number.parseInt(signature.slice(130, 132), 16);
  if ((v !== 27 && v !== 28) || BigInt(sigS) === 0n || BigInt(sigS) > halfOrder) return invalid();
  const typedData = { domain: { name: 'BaseSepoliaPrediction', version: '1', chainId: baseSepolia.id, verifyingContract: contract }, types: swipeTypes, primaryType: 'Swipe' as const, message: swipe };
  let signer: Address;
  try { signer = await recoverTypedDataAddress({ ...typedData, signature }); } catch { return invalid(); }
  if (signer.toLowerCase() !== swipe.delegate.toLowerCase()) return invalid();
  return { swipe, v, r, sigS, digest: hashTypedData(typedData) };
}
