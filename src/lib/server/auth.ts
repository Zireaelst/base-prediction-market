import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { database } from './db';
import { assertInput, DomainError } from './errors';
import type { User } from '../contracts';

interface UserRow { id: number; handle: string; created_at: string; password_hash: string; wallet_address?: string | null; }
const sessionLifetime = 30 * 24 * 60 * 60 * 1000;
export const sessionCookie = 'prediction_session';
function toUser(row: UserRow): User { return { id: row.id, handle: row.handle, createdAt: row.created_at, ...(row.wallet_address ? { walletAddress: row.wallet_address } : {}) }; }
function tokenDigest(token: string): string { return createHash('sha256').update(token).digest('hex'); }

export function register(handle: string, password: string): { user: User; token: string } {
  assertInput(typeof handle === 'string' && /^[a-zA-Z0-9_]{3,24}$/.test(handle), 'Handle must be 3–24 letters, numbers or underscores');
  assertInput(!/^w_[a-f0-9]{20}$/i.test(handle), 'This handle is reserved for wallet sign-in');
  assertInput(!/^p_[a-f0-9]{20}$/i.test(handle), 'This handle is reserved for Privy sign-in');
  assertInput(typeof password === 'string' && password.length >= 10 && password.length <= 256, 'Password must be between 10 and 256 characters');
  const salt = randomBytes(32).toString('hex');
  const passwordHash = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
  const db = database();
  try {
    const id = Number(db.prepare('INSERT INTO users (handle, password_hash, created_at) VALUES (?, ?, ?)').run(handle, passwordHash, new Date().toISOString()).lastInsertRowid);
    return issueSession(id);
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE')) throw new DomainError('Handle already registered', 409);
    throw error;
  }
}

export function login(handle: string, password: string): { user: User; token: string } {
  assertInput(typeof handle === 'string' && typeof password === 'string', 'Handle and password are required');
  const row = database().prepare('SELECT * FROM users WHERE handle = ?').get(handle) as UserRow | undefined;
  if (!row || row.password_hash === 'wallet-only' || row.password_hash === 'privy-only') throw new DomainError('Invalid handle or password', 401);
  const [salt, digest] = row.password_hash.split(':');
  const candidate = scryptSync(password, salt, 64);
  if (!timingSafeEqual(candidate, Buffer.from(digest, 'hex'))) throw new DomainError('Invalid handle or password', 401);
  return issueSession(row.id);
}

export function issueSession(userId: number, lifetime = sessionLifetime): { user: User; token: string } {
  const db = database();
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenDigest(token), userId, new Date(Date.now() + lifetime).toISOString());
  const row = db.prepare('SELECT u.*, w.address AS wallet_address FROM users u LEFT JOIN wallet_accounts w ON w.user_id = u.id WHERE u.id = ?').get(userId) as UserRow;
  return { user: toUser(row), token };
}

export function sessionUser(token: string | undefined): User | null {
  if (!token || !/^[a-zA-Z0-9_-]{43}$/.test(token)) return null;
  const row = database().prepare('SELECT u.*, w.address AS wallet_address FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN wallet_accounts w ON w.user_id = u.id WHERE s.token_hash = ? AND s.expires_at > ?').get(tokenDigest(token), new Date().toISOString()) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export function logout(token: string | undefined): void {
  if (token) database().prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenDigest(token));
}
