import { createHash, randomBytes } from 'node:crypto';
import { importSPKI, jwtVerify } from 'jose';
import { issueSession } from './auth';
import { database } from './db';
import { DomainError } from './errors';

export const privySessionSeconds = 60 * 60;

export function privyConfig(): { appId: string; verificationKey: string } | null {
  const appId = process.env.PRIVY_APP_ID?.trim();
  const verificationKey = process.env.PRIVY_VERIFICATION_KEY?.trim().replace(/\\n/g, '\n');
  return appId && verificationKey ? { appId, verificationKey } : null;
}

export async function signInWithPrivy(accessToken: unknown) {
  const config = privyConfig();
  if (!config) throw new DomainError('Privy sign-in is not configured', 503);
  if (typeof accessToken !== 'string' || accessToken.length > 8192 || !accessToken) throw new DomainError('Invalid Privy access token', 401);
  let key;
  try { key = await importSPKI(config.verificationKey, 'ES256'); }
  catch { throw new DomainError('Privy sign-in is misconfigured', 503); }
  let userId: string;
  try {
    const { payload } = await jwtVerify(accessToken, key, { issuer: 'privy.io', audience: config.appId, algorithms: ['ES256'], requiredClaims: ['sub', 'exp', 'iat', 'sid'] });
    if (typeof payload.sub !== 'string' || !payload.sub.startsWith('did:privy:') || payload.sub.length > 512 || typeof payload.sid !== 'string' || !payload.sid) throw new Error('Invalid claims');
    userId = payload.sub;
  } catch { throw new DomainError('Invalid or expired Privy access token', 401); }

  const db = database();
  return db.transaction(() => {
    let id = (db.prepare('SELECT user_id FROM privy_accounts WHERE app_id = ? AND privy_user_id = ?').get(config.appId, userId) as { user_id: number } | undefined)?.user_id;
    if (!id) {
      const digest = createHash('sha256').update(config.appId).update('\0').update(userId).digest('hex');
      let handle = `p_${digest.slice(0, 20)}`;
      const exists = db.prepare('SELECT 1 FROM users WHERE handle = ?');
      while (exists.get(handle)) handle = `p_${randomBytes(10).toString('hex')}`;
      const createdAt = new Date().toISOString();
      id = Number(db.prepare('INSERT INTO users (handle, password_hash, created_at) VALUES (?, ?, ?)').run(handle, 'privy-only', createdAt).lastInsertRowid);
      db.prepare('INSERT INTO privy_accounts (app_id, privy_user_id, user_id, created_at) VALUES (?, ?, ?, ?)').run(config.appId, userId, id, createdAt);
    }
    return issueSession(id, privySessionSeconds * 1000);
  })();
}
