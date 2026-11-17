CREATE TYPE "public"."policy_status" AS ENUM('draft', 'in_force', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."policy_version_status" AS ENUM('draft', 'submitted', 'approved', 'rejected', 'superseded');--> statement-breakpoint
ALTER TYPE "public"."record_type" ADD VALUE 'policy';--> statement-breakpoint
ALTER TYPE "public"."record_type" ADD VALUE 'policy_version';--> statement-breakpoint
ALTER TYPE "public"."task_type" ADD VALUE 'policy_approval';--> statement-breakpoint
ALTER TYPE "public"."task_type" ADD VALUE 'policy_review';--> statement-breakpoint
CREATE TABLE "policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"entity_id" uuid,
	"reference" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"owner_id" uuid,
	"status" "policy_status" DEFAULT 'draft' NOT NULL,
	"review_interval_months" integer DEFAULT 12 NOT NULL,
	"next_review_at" timestamp with time zone,
	"last_reviewed_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_activity" (
	"organisation_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	CONSTRAINT "policy_activity_policy_id_activity_id_pk" PRIMARY KEY("policy_id","activity_id")
);
--> statement-breakpoint
CREATE TABLE "policy_ai_system" (
	"organisation_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"ai_use_case_id" uuid NOT NULL,
	CONSTRAINT "policy_ai_system_policy_id_ai_use_case_id_pk" PRIMARY KEY("policy_id","ai_use_case_id")
);
--> statement-breakpoint
CREATE TABLE "policy_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"label" text NOT NULL,
	"changes" text,
	"document_id" uuid,
	"status" "policy_version_status" DEFAULT 'draft' NOT NULL,
	"drafted_by_label" text NOT NULL,
	"submitted_by_user_id" uuid,
	"submitted_by_label" text,
	"submitted_at" timestamp with time zone,
	"decided_by_user_id" uuid,
	"decided_by_label" text,
	"decided_at" timestamp with time zone,
	"approval_reference" text,
	"rejection_reason" text,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "policy" ADD CONSTRAINT "policy_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy" ADD CONSTRAINT "policy_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy" ADD CONSTRAINT "policy_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_activity" ADD CONSTRAINT "policy_activity_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_activity" ADD CONSTRAINT "policy_activity_policy_id_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_activity" ADD CONSTRAINT "policy_activity_activity_id_processing_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."processing_activity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_ai_system" ADD CONSTRAINT "policy_ai_system_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_ai_system" ADD CONSTRAINT "policy_ai_system_policy_id_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_ai_system" ADD CONSTRAINT "policy_ai_system_ai_use_case_id_ai_use_case_id_fk" FOREIGN KEY ("ai_use_case_id") REFERENCES "public"."ai_use_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_version" ADD CONSTRAINT "policy_version_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_version" ADD CONSTRAINT "policy_version_policy_id_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_version" ADD CONSTRAINT "policy_version_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_version" ADD CONSTRAINT "policy_version_submitted_by_user_id_app_user_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_version" ADD CONSTRAINT "policy_version_decided_by_user_id_app_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "policy_reference_key" ON "policy" USING btree ("organisation_id","reference");--> statement-breakpoint
CREATE INDEX "policy_entity_idx" ON "policy" USING btree ("organisation_id","entity_id");--> statement-breakpoint
CREATE INDEX "policy_review_idx" ON "policy" USING btree ("organisation_id","next_review_at");--> statement-breakpoint
CREATE INDEX "policy_activity_idx" ON "policy_activity" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "policy_ai_system_idx" ON "policy_ai_system" USING btree ("ai_use_case_id");--> statement-breakpoint
CREATE INDEX "policy_version_policy_idx" ON "policy_version" USING btree ("policy_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_version_in_force" ON "policy_version" USING btree ("policy_id") WHERE "policy_version"."status" = 'approved';--> statement-breakpoint
CREATE UNIQUE INDEX "policy_version_open" ON "policy_version" USING btree ("policy_id") WHERE "policy_version"."status" in ('draft', 'submitted');