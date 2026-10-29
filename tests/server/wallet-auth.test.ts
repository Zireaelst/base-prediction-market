import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { parseSiweMessage } from 'viem/siwe';
import { closeDatabase, database } from '../../src/lib/server/db';
import { login, register, sessionUser } from '../../src/lib/server/auth';
import { createWalletChallenge, verifyWalletChallenge } from '../../src/lib/server/wallet-auth';
import { createRoom, getRoom, getProfile } from '../../src/lib/server/domain';

const origin = 'http://localhost:3000';
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wallet-auth-')); process.env.DB_PATH = join(dir, 'test.sqlite'); });
afterEach(() => { closeDatabase(); rmSync(dir, { recursive: true, force: true }); delete process.env.DB_PATH; });

async function signedChallenge(address?: PrivateKeyAccount) {
  const signer = address ?? privateKeyToAccount(generatePrivateKey());
  const message = createWalletChallenge(signer.address, origin);
  return { signer, message, signature: await signer.signMessage({ message }) };
}

describe('Base Sepolia wallet identity', () => {
  it('issues an origin-bound, expiring Sepolia SIWE challenge, never an authenticated session merely for connecting', async () => {
    const { signer, message } = await signedChallenge();
    const parsed = parseSiweMessage(message);
    expect(parsed).toMatchObject({ address: signer.address, domain: 'localhost:3000', uri: origin, chainId: 84532, version: '1' });
    expect(parsed.expirationTime?.getTime()).toBeGreaterThan(Date.now());
    expect(database().prepare('SELECT COUNT(*) AS count FROM sessions').get()).toEqual({ count: 0 });
    expect(database().prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 0 });
  });

  it('accepts a real EOA signature once and restores the same wallet user and private-room access', async () => {
    const { signer, message, signature } = await signedChallenge();
    const first = await verifyWalletChallenge(message, signature, origin);
    expect(sessionUser(first.token)).toEqual(first.user);
    expect(first.user.handle).toMatch(/^w_[a-f0-9]{20}$/);
    expect(first.user.walletAddress).toBe(signer.address.toLowerCase());
    expect(getProfile(first.user.handle, null).user.walletAddress).toBeUndefined();
    const room = createRoom(first.user.id, 'Wallet room', 'Private', true);
    expect(getRoom(room.id, first.user.id).room.role).toBe('owner');
    await expect(verifyWalletChallenge(message, signature, origin)).rejects.toMatchObject({ status: 401 });
    const again = await signedChallenge(signer);
    const next = await verifyWalletChallenge(again.message, again.signature, origin);
    expect(next.user.id).toBe(first.user.id);
    expect(getRoom(room.id, next.user.id).room.role).toBe('owner');
    expect(database().prepare('SELECT COUNT(*) AS count FROM wallet_accounts').get()).toEqual({ count: 1 });
  });

  it('allows exactly one concurrent session issuance per signed nonce', async () => {
    const { message, signature } = await signedChallenge();
    const attempts = await Promise.allSettled([
      verifyWalletChallenge(message, signature, origin),
      verifyWalletChallenge(message, signature, origin),
    ]);
    expect(attempts.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(database().prepare('SELECT COUNT(*) AS count FROM sessions').get()).toEqual({ count: 1 });
    expect(database().prepare('SELECT COUNT(*) AS count FROM wallet_accounts').get()).toEqual({ count: 1 });
  });

  it('refuses tampered domains, origins and chain IDs without consuming a valid challenge', async () => {
    const { message, signature } = await signedChallenge();
    await expect(verifyWalletChallenge(message, signature, 'https://other.example')).rejects.toMatchObject({ status: 401 });
    await expect(verifyWalletChallenge(message.replace('Chain ID: 84532', 'Chain ID: 8453'), signature, origin)).rejects.toMatchObject({ status: 401 });
    await expect(verifyWalletChallenge(message.replace('localhost:3000', 'evil.example'), signature, origin)).rejects.toMatchObject({ status: 401 });
    expect((await verifyWalletChallenge(message, signature, origin)).user.id).toBeGreaterThan(0);
  });

  it('rejects invalid signatures and expired challenges without creating an account', async () => {
    const signer = privateKeyToAccount(generatePrivateKey());
    const message = createWalletChallenge(signer.address, origin);
    await expect(verifyWalletChallenge(message, '0x123', origin)).rejects.toMatchObject({ status: 401 });
    const signature = await signer.signMessage({ message });
    const { nonce } = parseSiweMessage(message);
    expect(nonce).toBeTruthy();
    database().prepare('UPDATE wallet_challenges SET expires_at = ?').run('2000-01-01T00:00:00.000Z');
    await expect(verifyWalletChallenge(message, signature, origin)).rejects.toMatchObject({ status: 401 });
    expect(database().prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 0 });
  });

  it('keeps existing password identities separate and disallows password login to wallet-only accounts', async () => {
    const local = register('alice', 'correct horse battery staple');
    const { message, signature } = await signedChallenge();
    const wallet = await verifyWalletChallenge(message, signature, origin);
    expect(wallet.user.id).not.toBe(local.user.id);
    expect(() => login(wallet.user.handle, 'any password')).toThrow('Invalid handle or password');
    expect(login('alice', 'correct horse battery staple').user).toEqual(local.user);
  });
  it('does not let an existing password handle claim or block its matching wallet', async () => {
    const signer = privateKeyToAccount(generatePrivateKey());
    const reserved = `w_${createHash('sha256').update(signer.address.toLowerCase()).digest('hex').slice(0, 20)}`;
    const passwordUser = register('alice', 'correct horse battery staple').user;
    database().prepare('UPDATE users SET handle = ? WHERE id = ?').run(reserved, passwordUser.id);
    expect(() => register(reserved.toUpperCase(), 'correct horse battery staple')).toThrow('reserved for wallet sign-in');
    const message = createWalletChallenge(signer.address, origin);
    const walletUser = (await verifyWalletChallenge(message, await signer.signMessage({ message }), origin)).user;
    expect(walletUser.id).not.toBe(passwordUser.id);
    expect(walletUser.handle).not.toBe(reserved);
    expect(login(reserved, 'correct horse battery staple').user.id).toBe(passwordUser.id);
  });
});
