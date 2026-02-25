CREATE TABLE `companion_insights` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`category` text NOT NULL,
	`content` text NOT NULL,
	`confidence` real DEFAULT 0.7 NOT NULL,
	`source` text DEFAULT 'ai-observed' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `companion_insights_user_updated_idx` ON `companion_insights` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `companion_insights_user_category_idx` ON `companion_insights` (`user_id`,`category`);--> statement-breakpoint
CREATE TABLE `companion_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text,
	`emoji` text,
	`mode` text DEFAULT 'suggest' NOT NULL,
	`trust_level` integer DEFAULT 0 NOT NULL,
	`trust_score` integer DEFAULT 0 NOT NULL,
	`provider` text DEFAULT 'anthropic' NOT NULL,
	`model` text DEFAULT 'claude-3-5-haiku-latest' NOT NULL,
	`system_prompt` text,
	`user_context` text,
	`config` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companion_settings_user_idx` ON `companion_settings` (`user_id`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `conversations_user_updated_idx` ON `conversations` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `forge_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`trigger_type` text NOT NULL,
	`trigger_config` text DEFAULT '{}' NOT NULL,
	`action_type` text NOT NULL,
	`action_config` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `forge_rules_user_enabled_idx` ON `forge_rules` (`user_id`,`enabled`);--> statement-breakpoint
CREATE TABLE `forge_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`trigger_type` text NOT NULL,
	`trigger_payload` text DEFAULT '{}' NOT NULL,
	`action_type` text NOT NULL,
	`action_payload` text DEFAULT '{}' NOT NULL,
	`status` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`error` text,
	`started_at` integer NOT NULL,
	`finished_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rule_id`) REFERENCES `forge_rules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `forge_runs_user_started_idx` ON `forge_runs` (`user_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `forge_runs_rule_started_idx` ON `forge_runs` (`rule_id`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `forge_runs_rule_dedupe_idx` ON `forge_runs` (`rule_id`,`dedupe_key`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`tool_calls` text,
	`tool_results` text,
	`attachments` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_conversation_idx` ON `messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `prompt_history` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `prompt_history_user_created_idx` ON `prompt_history` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `proofs` (
	`id` text PRIMARY KEY NOT NULL,
	`quest_log_id` text NOT NULL,
	`type` text NOT NULL,
	`confidence` real,
	`data` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`quest_log_id`) REFERENCES `quest_logs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `proofs_quest_log_idx` ON `proofs` (`quest_log_id`);--> statement-breakpoint
CREATE TABLE `quest_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`quest_id` text NOT NULL,
	`user_id` text NOT NULL,
	`completed_at` integer NOT NULL,
	`duration_minutes` integer,
	`xp_earned` integer NOT NULL,
	`proof_type` text NOT NULL,
	`proof_data` text DEFAULT '{}' NOT NULL,
	`streak_day` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`quest_id`) REFERENCES `quests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `quest_logs_quest_completed_idx` ON `quest_logs` (`quest_id`,`completed_at`);--> statement-breakpoint
CREATE INDEX `quest_logs_user_completed_idx` ON `quest_logs` (`user_id`,`completed_at`);--> statement-breakpoint
CREATE TABLE `quests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`parent_id` text,
	`title` text NOT NULL,
	`description` text,
	`type` text NOT NULL,
	`difficulty` text NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`objectives` text DEFAULT '[]' NOT NULL,
	`skill_tags` text DEFAULT '[]' NOT NULL,
	`schedule_cron` text,
	`streak_count` integer DEFAULT 0 NOT NULL,
	`base_xp` integer DEFAULT 10 NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`deadline_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `quests`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `quests_user_status_idx` ON `quests` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `quests_user_updated_idx` ON `quests` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `quests_status_deadline_idx` ON `quests` (`status`,`deadline_at`);--> statement-breakpoint
CREATE INDEX `quests_parent_idx` ON `quests` (`parent_id`);--> statement-breakpoint
CREATE INDEX `quests_user_title_idx` ON `quests` (`user_id`,`title`);--> statement-breakpoint
CREATE TABLE `rituals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`frequency` text NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`schedule_cron` text,
	`window_start` text,
	`window_end` text,
	`streak_current` integer DEFAULT 0 NOT NULL,
	`streak_best` integer DEFAULT 0 NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rituals_user_state_idx` ON `rituals` (`user_id`,`state`);--> statement-breakpoint
CREATE TABLE `signals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`type` text NOT NULL,
	`confidence` real NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`detected_at` integer NOT NULL,
	`ingested_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `signals_user_detected_idx` ON `signals` (`user_id`,`detected_at`);--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`level` integer DEFAULT 0 NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skills_user_name_idx` ON `skills` (`user_id`,`name`);--> statement-breakpoint
CREATE INDEX `skills_parent_idx` ON `skills` (`parent_id`);--> statement-breakpoint
CREATE INDEX `skills_user_category_idx` ON `skills` (`user_id`,`category`);--> statement-breakpoint
CREATE TABLE `trust_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`level` integer NOT NULL,
	`action` text NOT NULL,
	`outcome` text NOT NULL,
	`trust_delta` integer NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trust_log_user_created_idx` ON `trust_log` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`total_xp` integer DEFAULT 0 NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`locale` text DEFAULT 'en-US' NOT NULL,
	`notifications_enabled` integer DEFAULT true NOT NULL,
	`companion_enabled` integer DEFAULT false NOT NULL,
	`preferred_model` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
