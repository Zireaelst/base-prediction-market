import { describe, expect, it } from 'vitest';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { validateSwipe } from '../../src/lib/server/testnet-swipe';

const types = { Swipe: [
  { name: 'owner', type: 'address' }, { name: 'delegate', type: 'address' }, { name: 'kind', type: 'uint8' },
  { name: 'marketId', type: 'uint256' }, { name: 'target', type: 'uint256' }, { name: 'deadline', type: 'uint64' },
  { name: 'stake', type: 'uint256' }, { name: 'creatorAbove', type: 'bool' }, { name: 'nonce', type: 'uint256' },
  { name: 'validUntil', type: 'uint64' }, { name: 'epoch', type: 'uint256' },
] } as const;

describe('testnet delegated swipes', () => {
  it('accepts the delegate signature only for the signed market, owner and contract', async () => {
    const owner = privateKeyToAccount(generatePrivateKey()).address;
    const delegate = privateKeyToAccount(generatePrivateKey());
    const contract = privateKeyToAccount(generatePrivateKey()).address;
    const message = { owner, delegate: delegate.address, kind: 1, marketId: 1n, target: 0n, deadline: 0n, stake: 10n, creatorAbove: false, nonce: 1n, validUntil: 2000000000n, epoch: 1n } as const;
    const signature = await delegate.signTypedData({ domain: { name: 'BaseSepoliaPrediction', version: '1', chainId: 84532, verifyingContract: contract }, types, primaryType: 'Swipe', message });
    const swipe = { ...message, marketId: '1', target: '0', deadline: 0, stake: '10', nonce: '1', validUntil: 2000000000, epoch: '1' };
    const body = { swipe, signature };
    expect((await validateSwipe(body, owner, contract)).swipe.marketId).toBe(1n);
    await expect(validateSwipe({ swipe: { ...swipe, marketId: '2' }, signature }, owner, contract)).rejects.toThrow();
    await expect(validateSwipe(body, delegate.address, contract)).rejects.toThrow();
    await expect(validateSwipe(body, owner, delegate.address)).rejects.toThrow();
  });
});
