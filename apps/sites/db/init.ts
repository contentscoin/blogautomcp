import { getD1 } from './index';

let initialization: Promise<void> | null = null;
const statements = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL, display_name TEXT, role TEXT NOT NULL DEFAULT 'USER', status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
  `CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)`,
  `CREATE TABLE IF NOT EXISTS mcp_connections (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, endpoint_id TEXT NOT NULL, secret_hash TEXT NOT NULL, generation INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'ACTIVE', created_at INTEGER NOT NULL, rotated_at INTEGER)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_connections_user ON mcp_connections(user_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_connections_endpoint ON mcp_connections(endpoint_id)`,
  `CREATE TABLE IF NOT EXISTS oauth_authorization_codes (code_hash TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, resource TEXT NOT NULL, scope TEXT NOT NULL, code_challenge TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, consumed_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_oauth_codes_user_expires ON oauth_authorization_codes(user_id, expires_at)`,
  `CREATE TABLE IF NOT EXISTS oauth_tokens (id TEXT PRIMARY KEY NOT NULL, access_token_hash TEXT NOT NULL, refresh_token_hash TEXT, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, client_id TEXT NOT NULL, resource TEXT NOT NULL, scope TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE', access_expires_at INTEGER NOT NULL, refresh_expires_at INTEGER, created_at INTEGER NOT NULL, rotated_at INTEGER, revoked_at INTEGER)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_tokens_access ON oauth_tokens(access_token_hash)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_tokens_refresh ON oauth_tokens(refresh_token_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user_status ON oauth_tokens(user_id, status)`,
  `CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL, name TEXT NOT NULL, platform TEXT, app_version TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE', paired_at INTEGER NOT NULL, last_seen_at INTEGER, revoked_at INTEGER)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_token ON devices(token_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_devices_user_status ON devices(user_id, status)`,
  `CREATE TABLE IF NOT EXISTS agent_jobs (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, type TEXT NOT NULL, connect_kind TEXT, input_json TEXT NOT NULL, result_json TEXT, status TEXT NOT NULL DEFAULT 'QUEUED', progress INTEGER NOT NULL DEFAULT 0, idempotency_key TEXT, claimed_by_device_id TEXT, error_code TEXT, error_message TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, claimed_at INTEGER, finished_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_jobs_user_status_created ON agent_jobs(user_id, status, created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_jobs_user_idempotency ON agent_jobs(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY NOT NULL, actor_user_id TEXT, target_user_id TEXT, action TEXT NOT NULL, metadata_json TEXT, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at)`,
];

export async function ensureDatabase(): Promise<void> {
  initialization ??= (async () => {
    const d1 = getD1();
    await d1.batch(statements.map((statement) => d1.prepare(statement)));
    await d1.prepare('PRAGMA optimize').run();
  })().catch((error) => { initialization = null; throw error; });
  return initialization;
}
