CREATE TABLE `agent_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`connect_kind` text,
	`input_json` text NOT NULL,
	`result_json` text,
	`status` text DEFAULT 'QUEUED' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`idempotency_key` text,
	`claimed_by_device_id` text,
	`error_code` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`claimed_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_agent_jobs_user_status_created` ON `agent_jobs` (`user_id`,`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_agent_jobs_user_idempotency` ON `agent_jobs` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`target_user_id` text,
	`action` text NOT NULL,
	`metadata_json` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_events_created` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`name` text NOT NULL,
	`platform` text,
	`app_version` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`paired_at` integer NOT NULL,
	`last_seen_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_devices_token` ON `devices` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_devices_user_status` ON `devices` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `mcp_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint_id` text NOT NULL,
	`secret_hash` text NOT NULL,
	`generation` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` integer NOT NULL,
	`rotated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_mcp_connections_user` ON `mcp_connections` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_mcp_connections_endpoint` ON `mcp_connections` (`endpoint_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text,
	`role` text DEFAULT 'USER' NOT NULL,
	`status` text DEFAULT 'PENDING_APPROVAL' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `idx_users_status` ON `users` (`status`);