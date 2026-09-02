import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  role: text('role').notNull().default('USER'),
  status: text('status').notNull().default('PENDING_APPROVAL'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [uniqueIndex('idx_users_email').on(table.email), index('idx_users_status').on(table.status)]);

export const mcpConnections = sqliteTable('mcp_connections', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  endpointId: text('endpoint_id').notNull(),
  secretHash: text('secret_hash').notNull(),
  generation: integer('generation').notNull().default(1),
  status: text('status').notNull().default('ACTIVE'),
  createdAt: integer('created_at').notNull(),
  rotatedAt: integer('rotated_at'),
}, (table) => [uniqueIndex('idx_mcp_connections_user').on(table.userId), uniqueIndex('idx_mcp_connections_endpoint').on(table.endpointId)]);

export const devices = sqliteTable('devices', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  name: text('name').notNull(),
  platform: text('platform'),
  appVersion: text('app_version'),
  status: text('status').notNull().default('ACTIVE'),
  pairedAt: integer('paired_at').notNull(),
  lastSeenAt: integer('last_seen_at'),
  revokedAt: integer('revoked_at'),
  statusJson: text('status_json'),
}, (table) => [uniqueIndex('idx_devices_token').on(table.tokenHash), index('idx_devices_user_status').on(table.userId, table.status)]);

export const agentJobs = sqliteTable('agent_jobs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  connectKind: text('connect_kind'),
  inputJson: text('input_json').notNull(),
  resultJson: text('result_json'),
  status: text('status').notNull().default('QUEUED'),
  progress: integer('progress').notNull().default(0),
  idempotencyKey: text('idempotency_key'),
  claimedByDeviceId: text('claimed_by_device_id'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  claimedAt: integer('claimed_at'),
  finishedAt: integer('finished_at'),
  leaseUntil: integer('lease_until'),
  heartbeatAt: integer('heartbeat_at'),
  stage: text('stage'),
  stageMessage: text('stage_message'),
  cancelRequested: integer('cancel_requested').notNull().default(0),
}, (table) => [index('idx_agent_jobs_user_status_created').on(table.userId, table.status, table.createdAt), uniqueIndex('idx_agent_jobs_user_idempotency').on(table.userId, table.idempotencyKey)]);

export const auditEvents = sqliteTable('audit_events', {
  id: text('id').primaryKey(),
  actorUserId: text('actor_user_id'),
  targetUserId: text('target_user_id'),
  action: text('action').notNull(),
  metadataJson: text('metadata_json'),
  createdAt: integer('created_at').notNull(),
}, (table) => [index('idx_audit_events_created').on(table.createdAt)]);

export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(),
  windowStart: integer('window_start').notNull(),
  count: integer('count').notNull().default(0),
});

export const pairCodes = sqliteTable('pair_codes', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  codeHash: text('code_hash').notNull(),
  expiresAt: integer('expires_at').notNull(),
  usedAt: integer('used_at'),
  createdAt: integer('created_at').notNull(),
}, (table) => [uniqueIndex('idx_pair_codes_hash').on(table.codeHash), index('idx_pair_codes_user').on(table.userId, table.expiresAt)]);
