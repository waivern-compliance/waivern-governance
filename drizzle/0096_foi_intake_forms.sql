CREATE TYPE "public"."intake_form_kind" AS ENUM('data_protection', 'foi');--> statement-breakpoint
ALTER TYPE "public"."task_type" ADD VALUE 'foi_intake';--> statement-breakpoint
ALTER TABLE "dsr_intake_link" ADD COLUMN "kind" "intake_form_kind" DEFAULT 'data_protection' NOT NULL;--> statement-breakpoint
ALTER TABLE "information_request" ADD COLUMN "intake_link_id" uuid;--> statement-breakpoint
ALTER TABLE "information_request" ADD CONSTRAINT "information_request_intake_link_id_dsr_intake_link_id_fk" FOREIGN KEY ("intake_link_id") REFERENCES "public"."dsr_intake_link"("id") ON DELETE set null ON UPDATE no action;