CREATE TYPE "public"."information_request_status" AS ENUM('open', 'responded', 'closed', 'converted');--> statement-breakpoint
ALTER TYPE "public"."record_type" ADD VALUE 'information_request';--> statement-breakpoint
CREATE TABLE "information_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"act" text NOT NULL,
	"regimes" jsonb NOT NULL,
	"time_profile" text DEFAULT 'standard' NOT NULL,
	"channel" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"description" text NOT NULL,
	"requester_name" text NOT NULL,
	"correspondence_address" text,
	"pseudonymous" boolean DEFAULT false NOT NULL,
	"preferred_means" text,
	"clarification_sought_at" timestamp with time zone,
	"clarification_received_at" timestamp with time zone,
	"school_days_deadline" timestamp with time zone,
	"commission_set_deadline" timestamp with time zone,
	"extended_for_complexity" boolean DEFAULT false NOT NULL,
	"status" "information_request_status" DEFAULT 'open' NOT NULL,
	"owner_id" uuid,
	"responded_at" timestamp with time zone,
	"response_summary" text,
	"response_link" text,
	"late_reason" text,
	"published" boolean,
	"converted_to_request_id" uuid,
	"closed_at" timestamp with time zone,
	"closure_rationale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entity" ADD COLUMN "foi_act" text;--> statement-breakpoint
ALTER TABLE "entity" ADD COLUMN "foi_covered_for" text;--> statement-breakpoint
ALTER TABLE "entity" ADD COLUMN "foi_time_profile" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "information_request" ADD CONSTRAINT "information_request_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_request" ADD CONSTRAINT "information_request_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_request" ADD CONSTRAINT "information_request_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_request" ADD CONSTRAINT "information_request_converted_to_request_id_data_subject_request_id_fk" FOREIGN KEY ("converted_to_request_id") REFERENCES "public"."data_subject_request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "information_request_reference_key" ON "information_request" USING btree ("organisation_id","reference");--> statement-breakpoint
CREATE INDEX "information_request_status_idx" ON "information_request" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "information_request_received_idx" ON "information_request" USING btree ("organisation_id","received_at");--> statement-breakpoint
CREATE INDEX "information_request_converted_idx" ON "information_request" USING btree ("converted_to_request_id");--> statement-breakpoint
-- Tenant isolation, as for every table that carries its organisation (0052).
ALTER TABLE "information_request" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "information_request"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
