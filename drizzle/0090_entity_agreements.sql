CREATE TABLE "entity_agreement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"entity_name" text NOT NULL,
	"legal_entity_ref" text,
	"terms_version" text NOT NULL,
	"terms_sha256" text NOT NULL,
	"dpa_version" text NOT NULL,
	"dpa_sha256" text NOT NULL,
	"accepted_by" uuid NOT NULL,
	"accepted_by_email" text NOT NULL,
	"accepted_by_name" text NOT NULL,
	"accepted_by_position" text NOT NULL,
	"authority_confirmed" boolean NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "terms_acceptance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"terms_version" text NOT NULL,
	"terms_sha256" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entity_agreement" ADD CONSTRAINT "entity_agreement_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_agreement" ADD CONSTRAINT "entity_agreement_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_agreement" ADD CONSTRAINT "entity_agreement_accepted_by_app_user_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms_acceptance" ADD CONSTRAINT "terms_acceptance_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entity_agreement_entity_idx" ON "entity_agreement" USING btree ("entity_id","terms_version","dpa_version");--> statement-breakpoint
CREATE INDEX "entity_agreement_org_idx" ON "entity_agreement" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "terms_acceptance_user_idx" ON "terms_acceptance" USING btree ("user_id","terms_version");