CREATE TYPE "public"."information_request_regulator_event_kind" AS ENUM('application', 'enquiry', 'information_notice', 'decision_notice', 'complied', 'appeal_lodged', 'appeal_decided', 'enforcement_notice', 'closed');--> statement-breakpoint
CREATE TYPE "public"."information_request_review_outcome" AS ENUM('upheld', 'varied', 'reversed', 'declined');--> statement-breakpoint
CREATE TYPE "public"."information_request_review_status" AS ENUM('open', 'decided', 'withdrawn');--> statement-breakpoint
CREATE TABLE "information_request_regulator_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" "information_request_regulator_event_kind" NOT NULL,
	"case_reference" text,
	"note" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" uuid,
	"recorded_by_label" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "information_request_review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"regimes" jsonb NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"channel" text NOT NULL,
	"grounds" text NOT NULL,
	"about_no_response" boolean DEFAULT false NOT NULL,
	"late_accepted_reason" text,
	"exceptional" boolean DEFAULT false NOT NULL,
	"exceptional_reason" text,
	"school_days_deadline" timestamp with time zone,
	"reviewer_name" text,
	"reviewer_not_involved" boolean,
	"status" "information_request_review_status" DEFAULT 'open' NOT NULL,
	"outcome" "information_request_review_outcome",
	"decided_at" timestamp with time zone,
	"outcome_summary" text,
	"information_released" boolean,
	"notice_checked" boolean,
	"late_reason" text,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "information_request_regulator_event" ADD CONSTRAINT "information_request_regulator_event_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_request_regulator_event" ADD CONSTRAINT "information_request_regulator_event_request_id_information_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."information_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_request_regulator_event" ADD CONSTRAINT "information_request_regulator_event_recorded_by_app_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_request_review" ADD CONSTRAINT "information_request_review_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_request_review" ADD CONSTRAINT "information_request_review_request_id_information_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."information_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_request_review" ADD CONSTRAINT "information_request_review_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "information_request_regulator_event_request_idx" ON "information_request_regulator_event" USING btree ("request_id","occurred_at");--> statement-breakpoint
CREATE INDEX "information_request_review_request_idx" ON "information_request_review" USING btree ("request_id","requested_at");--> statement-breakpoint
CREATE INDEX "information_request_review_status_idx" ON "information_request_review" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "information_request_review_one_open_key" ON "information_request_review" USING btree ("request_id") WHERE "information_request_review"."status" = 'open';--> statement-breakpoint
-- Tenant isolation, as for every table that carries its organisation (0052).
ALTER TABLE "information_request_review" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "information_request_review"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
--> statement-breakpoint
ALTER TABLE "information_request_regulator_event" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "information_request_regulator_event"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
