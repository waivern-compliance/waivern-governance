ALTER TYPE "public"."record_type" ADD VALUE 'trial';--> statement-breakpoint
ALTER TYPE "public"."record_type" ADD VALUE 'trial_request';--> statement-breakpoint
CREATE TABLE "trial_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"trial_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"organisation_name" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"extended_days" integer,
	"decided_by_email" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trial_signup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"canonical_email" text NOT NULL,
	"token_hash" text NOT NULL,
	"ip_hash" text NOT NULL,
	"organisation_name" text,
	"fictional_data_accepted_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trial" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"canonical_email" text NOT NULL,
	"organisation_name" text,
	"fictional_data_accepted_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"converted_at" timestamp with time zone,
	"purged_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "simulated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trial_request" ADD CONSTRAINT "trial_request_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_request" ADD CONSTRAINT "trial_request_trial_id_trial_id_fk" FOREIGN KEY ("trial_id") REFERENCES "public"."trial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial" ADD CONSTRAINT "trial_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial" ADD CONSTRAINT "trial_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trial_request_one_pending_key" ON "trial_request" USING btree ("organisation_id") WHERE "trial_request"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "trial_request_status_idx" ON "trial_request" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trial_signup_token_key" ON "trial_signup" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "trial_signup_email_idx" ON "trial_signup" USING btree ("canonical_email","created_at");--> statement-breakpoint
CREATE INDEX "trial_signup_ip_idx" ON "trial_signup" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trial_organisation_key" ON "trial" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trial_email_key" ON "trial" USING btree ("canonical_email");--> statement-breakpoint
CREATE UNIQUE INDEX "trial_user_key" ON "trial" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trial_ends_idx" ON "trial" USING btree ("status","ends_at");