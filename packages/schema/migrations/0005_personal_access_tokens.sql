-- Personal access tokens (user-scoped bearer tokens for the remote MCP
-- server / future programmatic API use). Apply on prod with
--   pnpm exec wrangler d1 execute wana-control-plane --remote \
--     --file=packages/schema/migrations/0005_personal_access_tokens.sql
-- (the remote D1 has no d1_migrations tracking table — see deploy notes).

CREATE TABLE `personal_access_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`hint` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `personal_access_tokens_token_hash_unique` ON `personal_access_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_pat_user` ON `personal_access_tokens` (`user_id`);
