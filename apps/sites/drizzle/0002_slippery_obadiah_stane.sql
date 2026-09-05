CREATE TABLE `bug_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`summary` text NOT NULL,
	`diagnostics_json` text NOT NULL,
	`delivery_status` text DEFAULT 'PENDING' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_bug_reports_user_idempotency` ON `bug_reports` (`user_id`,`idempotency_key`);
-- Remaining snapshot deltas already exist via legacy db/init.ts migrations.
