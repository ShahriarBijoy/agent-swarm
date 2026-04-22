CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'modified', 'denied', 'timed_out');--> statement-breakpoint
CREATE TYPE "public"."bucket" AS ENUM('short', 'long', 'permanent');--> statement-breakpoint
CREATE TYPE "public"."cleanup_action" AS ENUM('promote', 'prune', 'merge', 'keep');--> statement-breakpoint
CREATE TYPE "public"."link_type" AS ENUM('merged', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."segment" AS ENUM('identity', 'correction', 'preference', 'relationship', 'knowledge', 'behavioral', 'context');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('queued', 'in_progress', 'awaiting_approval', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"segment" "segment" NOT NULL,
	"bucket" "bucket" DEFAULT 'short' NOT NULL,
	"content" text NOT NULL,
	"content_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED NOT NULL,
	"embedding" vector(1536),
	"importance" numeric(3, 2) NOT NULL,
	"importance_streak" integer DEFAULT 0 NOT NULL,
	"access_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tombstoned_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"link_type" "link_type" NOT NULL,
	"proposal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_segment_config" (
	"segment" "segment" PRIMARY KEY NOT NULL,
	"default_importance" numeric(3, 2) NOT NULL,
	"decay_lambda_short" double precision NOT NULL,
	"decay_lambda_long_factor" double precision DEFAULT 0.01 NOT NULL,
	"promotion_threshold_long" numeric(3, 2) DEFAULT '0.50' NOT NULL,
	"promotion_threshold_permanent" numeric(3, 2) DEFAULT '0.80' NOT NULL,
	"fast_track_permanent" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_cleanup_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"memory_id" uuid NOT NULL,
	"target_memory_id" uuid,
	"action" "cleanup_action" NOT NULL,
	"final_action" "cleanup_action",
	"consolidator" jsonb NOT NULL,
	"adversary" jsonb,
	"judge" jsonb,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_cleanup_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"candidates_considered" integer DEFAULT 0 NOT NULL,
	"proposals_generated" integer DEFAULT 0 NOT NULL,
	"proposals_contested" integer DEFAULT 0 NOT NULL,
	"proposals_judged" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"error" text,
	CONSTRAINT "memory_cleanup_runs_status_check" CHECK ("memory_cleanup_runs"."status" IN ('running','completed','failed'))
);
--> statement-breakpoint
CREATE TABLE "task_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_events_type_check" CHECK ("task_events"."type" IN ('assistant_turn','tool_call','tool_result','approval_request','compact_boundary','run_result','user_message'))
);
--> statement-breakpoint
CREATE TABLE "task_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" "task_status" DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"total_cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"total_input_tokens" integer DEFAULT 0 NOT NULL,
	"total_output_tokens" integer DEFAULT 0 NOT NULL,
	"error" text,
	"session_id" text
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt" text NOT NULL,
	"status" "task_status" DEFAULT 'queued' NOT NULL,
	"created_by" text,
	"max_budget_usd" numeric(10, 4),
	"max_turns" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_gates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"proposed_input" jsonb NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"resolution_input" jsonb,
	"reviewer_note" text,
	"reviewer_id" text,
	"inngest_event_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"timed_out_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "memory_links" ADD CONSTRAINT "memory_links_parent_id_memories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."memories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_links" ADD CONSTRAINT "memory_links_child_id_memories_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."memories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_cleanup_proposals" ADD CONSTRAINT "memory_cleanup_proposals_run_id_memory_cleanup_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."memory_cleanup_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_cleanup_proposals" ADD CONSTRAINT "memory_cleanup_proposals_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_cleanup_proposals" ADD CONSTRAINT "memory_cleanup_proposals_target_memory_id_memories_id_fk" FOREIGN KEY ("target_memory_id") REFERENCES "public"."memories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_run_id_task_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."task_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_gates" ADD CONSTRAINT "approval_gates_run_id_task_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."task_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_gates" ADD CONSTRAINT "approval_gates_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memories_embedding_hnsw_idx" ON "memories" USING hnsw ("embedding" vector_cosine_ops) WITH (m=16,ef_construction=64) WHERE "memories"."tombstoned_at" IS NULL;--> statement-breakpoint
CREATE INDEX "memories_content_tsv_gin_idx" ON "memories" USING gin ("content_tsv") WHERE "memories"."tombstoned_at" IS NULL;--> statement-breakpoint
CREATE INDEX "memories_decay_btree_idx" ON "memories" USING btree ("bucket","importance" DESC NULLS LAST,"last_accessed_at" DESC NULLS LAST) WHERE "memories"."tombstoned_at" IS NULL;--> statement-breakpoint
CREATE INDEX "memories_segment_tombstone_idx" ON "memories" USING btree ("segment","tombstoned_at");--> statement-breakpoint
CREATE INDEX "memory_links_parent_idx" ON "memory_links" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "memory_links_child_idx" ON "memory_links" USING btree ("child_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_links_pair_type_uq" ON "memory_links" USING btree ("parent_id","child_id","link_type");--> statement-breakpoint
CREATE INDEX "memory_cleanup_proposals_run_idx" ON "memory_cleanup_proposals" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "memory_cleanup_proposals_memory_idx" ON "memory_cleanup_proposals" USING btree ("memory_id");--> statement-breakpoint
CREATE INDEX "memory_cleanup_proposals_applied_idx" ON "memory_cleanup_proposals" USING btree ("applied_at");--> statement-breakpoint
CREATE INDEX "task_events_task_id_idx" ON "task_events" USING btree ("task_id","id");--> statement-breakpoint
CREATE INDEX "task_events_run_seq_idx" ON "task_events" USING btree ("run_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "task_events_run_seq_uq" ON "task_events" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "task_runs_task_idx" ON "task_runs" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_runs_task_attempt_uq" ON "task_runs" USING btree ("task_id","attempt");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_created_at_idx" ON "tasks" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "approval_gates_run_idx" ON "approval_gates" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "approval_gates_status_idx" ON "approval_gates" USING btree ("status");