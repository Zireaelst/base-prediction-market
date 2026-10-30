import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

let instance: Database.Database | null = null;
let activePath: string | null = null;

export function database(): Database.Database {
  const path = resolve(process.env.DB_PATH || '.data/prediction.sqlite');
  if (instance && activePath === path) return instance;
  if (instance) instance.close();
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, handle TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL, notifications INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS wallet_accounts (chain_id INTEGER NOT NULL CHECK (chain_id = 84532), address TEXT NOT NULL, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL, PRIMARY KEY (chain_id, address));
    CREATE TABLE IF NOT EXISTS wallet_challenges (nonce_hash TEXT PRIMARY KEY, address TEXT NOT NULL, origin TEXT NOT NULL, message TEXT NOT NULL, expires_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS wallet_challenges_expiry ON wallet_challenges(expires_at);
    CREATE TABLE IF NOT EXISTS rooms (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, owner_id INTEGER NOT NULL REFERENCES users(id), private INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'shared' CHECK (kind IN ('shared', 'personal')), lock_at TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS room_members (room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id), PRIMARY KEY (room_id, user_id));
    CREATE TABLE IF NOT EXISTS forecasts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), room_id INTEGER NOT NULL REFERENCES rooms(id), market_id TEXT NOT NULL, market_slug TEXT NOT NULL, outcome_id TEXT NOT NULL, terms_version TEXT, market_snapshot TEXT, probability REAL NOT NULL, rationale TEXT NOT NULL, created_at TEXT NOT NULL, revised_at TEXT NOT NULL, lock_at TEXT NOT NULL, score REAL, score_version TEXT, UNIQUE (user_id, room_id, market_id));
    CREATE TABLE IF NOT EXISTS forecast_revisions (id INTEGER PRIMARY KEY, forecast_id INTEGER NOT NULL REFERENCES forecasts(id) ON DELETE CASCADE, probability REAL NOT NULL, rationale TEXT NOT NULL, at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS score_history (id INTEGER PRIMARY KEY, forecast_id INTEGER NOT NULL REFERENCES forecasts(id) ON DELETE CASCADE, outcome_id TEXT NOT NULL, score REAL, version TEXT NOT NULL, corrected_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS paper_orders (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), market_id TEXT NOT NULL, market_slug TEXT NOT NULL, outcome_id TEXT NOT NULL, side TEXT NOT NULL, stake_cents INTEGER NOT NULL, price REAL NOT NULL, shares REAL NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, observed_at TEXT NOT NULL, terms_version TEXT NOT NULL, settlement_cents INTEGER, model TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS paper_settlement_history (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES paper_orders(id) ON DELETE CASCADE, settlement_cents INTEGER, version TEXT NOT NULL, corrected_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS notices (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), kind TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT);
    CREATE TABLE IF NOT EXISTS market_resolutions (market_id TEXT PRIMARY KEY, outcome_id TEXT NOT NULL, version TEXT NOT NULL, observed_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'confirmed');
    CREATE TABLE IF NOT EXISTS venue_cache (cache_key TEXT PRIMARY KEY, payload TEXT NOT NULL, observed_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS forecasts_market ON forecasts(market_id);
    CREATE INDEX IF NOT EXISTS paper_market ON paper_orders(market_id);
    CREATE INDEX IF NOT EXISTS room_members_user ON room_members(user_id);
  `);
  if (!(db.pragma('table_info(forecasts)') as { name: string }[]).some(column => column.name === 'terms_version')) db.exec('ALTER TABLE forecasts ADD COLUMN terms_version TEXT');
  if (!(db.pragma('table_info(forecasts)') as { name: string }[]).some(column => column.name === 'market_snapshot')) db.exec('ALTER TABLE forecasts ADD COLUMN market_snapshot TEXT');
  if (!(db.pragma('table_info(market_resolutions)') as { name: string }[]).some(column => column.name === 'state')) db.exec("ALTER TABLE market_resolutions ADD COLUMN state TEXT NOT NULL DEFAULT 'confirmed'");
  if (!(db.pragma('table_info(rooms)') as { name: string }[]).some(column => column.name === 'kind')) db.exec("ALTER TABLE rooms ADD COLUMN kind TEXT NOT NULL DEFAULT 'shared' CHECK (kind IN ('shared', 'personal'))");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS rooms_personal_owner ON rooms(owner_id) WHERE kind = 'personal'");
  activePath = path;
  instance = db;
  return db;
}

export function closeDatabase(): void {
  instance?.close();
  instance = null;
  activePath = null;
}
