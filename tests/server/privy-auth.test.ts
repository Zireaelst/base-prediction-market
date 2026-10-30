import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportSPKI, generateKeyPair, SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { POST as privyLogin } from '../../src/app/api/auth/privy/route';
import { closeDatabase, database } from '../../src/lib/server/db';
import { login, register, sessionUser } from '../../src/lib/server/auth';
import { signInWithPrivy } from '../../src/lib/server/privy-auth';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'privy-auth-')); process.env.DB_PATH = join(dir, 'test.sqlite'); });
afterEach(() => { closeDatabase(); rmSync(dir, { recursive: true, force: true }); delete process.env.DB_PATH; delete process.env.PRIVY_APP_ID; delete process.env.PRIVY_VERIFICATION_KEY; });

describe('Privy identity', () => {
  it('verifies signed tokens, preserves separate identities, and restores the same account', async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    process.env.PRIVY_APP_ID = 'app-one';
    process.env.PRIVY_VERIFICATION_KEY = await exportSPKI(publicKey);
    const token = await new SignJWT({ sid: 'session' }).setProtectedHeader({ alg: 'ES256' }).setIssuer('privy.io').setAudience('app-one').setSubject('did:privy:user1').setIssuedAt().setExpirationTime('1h').sign(privateKey);
    const local = register('alice', 'correct horse battery staple');
    const first = await signInWithPrivy(token);
    expect(first.user.id).not.toBe(local.user.id);
    expect(sessionUser(first.token)).toEqual(first.user);
    expect((await signInWithPrivy(token)).user.id).toBe(first.user.id);
    expect(() => login(first.user.handle, 'any password')).toThrow('Invalid handle or password');
  });
  it('rejects disabled, invalid, expired and wrong-audience tokens without creating users', async () => {
    await expect(signInWithPrivy('invalid')).rejects.toMatchObject({ status: 503 });
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    process.env.PRIVY_APP_ID = 'app-one'; process.env.PRIVY_VERIFICATION_KEY = await exportSPKI(publicKey);
    const token = (aud: string, expiry: string) => new SignJWT({ sid: 'session' }).setProtectedHeader({ alg: 'ES256' }).setIssuer('privy.io').setAudience(aud).setSubject('did:privy:user1').setIssuedAt().setExpirationTime(expiry).sign(privateKey);
    await expect(signInWithPrivy('invalid')).rejects.toMatchObject({ status: 401 });
    await expect(signInWithPrivy(await token('other', '1h'))).rejects.toMatchObject({ status: 401 });
    await expect(signInWithPrivy(await token('app-one', '-1h'))).rejects.toMatchObject({ status: 401 });
    expect(database().prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 0 });
  });
  it('does not replace an existing local session when asked to sign in', async () => {
    const existing = register('alice', 'correct horse battery staple');
    const request = new NextRequest('http://localhost:3000/api/auth/privy', {
      method: 'POST',
      headers: { cookie: `prediction_session=${existing.token}`, authorization: 'Bearer invalid', origin: 'http://localhost:3000' },
    });
    const response = await privyLogin(request);
    expect(response.status).toBe(409);
    expect(sessionUser(existing.token)).toEqual(existing.user);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
