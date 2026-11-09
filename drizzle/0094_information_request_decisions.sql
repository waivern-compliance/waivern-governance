CREATE TYPE "public"."information_request_decision_kind" AS ENUM('held', 'neither_confirm_nor_deny', 'exemption', 'public_interest_extension', 'complexity_extension', 'fees_notice', 'fee_paid', 'fee_lapsed', 'cost_limit', 'vexatious', 'repeated', 'transferred', 'advice');--> statement-breakpoint
ALTER TYPE "public"."record_type" ADD VALUE 'information_request_decision';--> statement-breakpoint
ALTER TYPE "public"."task_type" ADD VALUE 'foi_deadline';--> statement-breakpoint
CREATE TABLE "information_request_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" "information_request_decision_kind" NOT NULL,
	"regime" text,
	"provision" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rationale" text NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_by_label" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "information_request" ADD COLUMN "refusal_notice_checked" boolean;--> statement-breakpoint
ALTER TABLE "information_request_decision" ADD CONSTRAINT "information_request_decision_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_request_decision" ADD CONSTRAINT "information_request_decision_request_id_information_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."information_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_request_decision" ADD CONSTRAINT "information_request_decision_decided_by_app_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "information_request_decision_request_idx" ON "information_request_decision" USING btree ("request_id","decided_at");--> statement-breakpoint
CREATE INDEX "information_request_decision_kind_idx" ON "information_request_decision" USING btree ("organisation_id","kind");--> statement-breakpoint
-- Tenant isolation, as for every table that carries its organisation (0052).
ALTER TABLE "information_request_decision" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "information_request_decision"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
