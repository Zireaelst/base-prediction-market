import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDatabase } from '../../src/lib/server/db';
import { register, login, logout, sessionUser } from '../../src/lib/server/auth';
import { createRoom, ensurePersonalRoom, joinRoom, inviteToRoom, getRoom, listRooms, getProfile } from '../../src/lib/server/domain';
import { DomainError } from '../../src/lib/server/errors';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'prediction-auth-')); process.env.DB_PATH = join(dir, 'test.sqlite'); });
afterEach(() => { closeDatabase(); rmSync(dir, { recursive: true, force: true }); delete process.env.DB_PATH; });

describe('local identity and room privacy', () => {
  it('persists password hashes and revocable sessions, never passwords', () => {
    const { user, token } = register('alice', 'correct horse battery staple');
    expect(sessionUser(token)).toEqual(user);
    expect(() => login('alice', 'wrong password')).toThrow(DomainError);
    expect(login('alice', 'correct horse battery staple').user).toEqual(user);
    logout(token);
    expect(sessionUser(token)).toBeNull();
  });
  it('hides private room and its forecasts from nonmembers and public profiles', () => {
    const alice = register('alice', 'long-secret-one').user;
    const bob = register('bob', 'long-secret-two').user;
    const privateRoom = createRoom(alice.id, 'Secret', 'Prediction practice', true);
    expect(privateRoom.role).toBe('owner');
    expect(listRooms(bob.id)).toEqual([]);
    expect(() => getRoom(privateRoom.id, bob.id)).toThrow(DomainError);
    expect(getProfile('alice', bob.id).forecasts).toEqual([]);
    expect(() => joinRoom(privateRoom.id, bob.id)).toThrow(DomainError);
    expect(getRoom(privateRoom.id, alice.id).room.memberCount).toBe(1);
    expect(() => inviteToRoom(privateRoom.id, bob.id, 'alice')).toThrow(DomainError);
    expect(inviteToRoom(privateRoom.id, alice.id, 'bob').memberCount).toBe(2);
    expect(getRoom(privateRoom.id, bob.id).room.role).toBe('member');
  });
  it('keeps the idempotent personal room owner-only and out of the shared directory', () => {
    const alice = register('alice', 'long-secret-one').user;
    const bob = register('bob', 'long-secret-two').user;
    const personal = ensurePersonalRoom(alice.id);
    expect(ensurePersonalRoom(alice.id).id).toBe(personal.id);
    expect(personal).toMatchObject({ private: true, kind: 'personal', memberCount: 1, role: 'owner' });
    expect(listRooms(alice.id)).toEqual([]);
    expect(listRooms(bob.id)).toEqual([]);
    expect(() => getRoom(personal.id, bob.id)).toThrow(DomainError);
    expect(() => joinRoom(personal.id, bob.id)).toThrow(DomainError);
    expect(() => inviteToRoom(personal.id, alice.id, 'bob')).toThrow(DomainError);
    expect(getRoom(personal.id, alice.id).room.id).toBe(personal.id);
  });
  it('migrates an existing room table and retains shared-room visibility', () => {
    const legacy = new Database(process.env.DB_PATH!);
    legacy.exec('CREATE TABLE rooms (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, owner_id INTEGER NOT NULL, private INTEGER NOT NULL, lock_at TEXT, created_at TEXT NOT NULL)');
    legacy.close();
    const alice = register('alice', 'long-secret-one').user;
    const room = createRoom(alice.id, 'Old room', '', false);
    expect(room.kind).toBe('shared');
    expect(listRooms(null)).toMatchObject([{ id: room.id, kind: 'shared' }]);
    expect(ensurePersonalRoom(alice.id).kind).toBe('personal');
  });
});
