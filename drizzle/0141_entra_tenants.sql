CREATE TABLE "organisation_entra_tenant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"tenant_id" text NOT NULL,
	"trusted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "entra_subject" text;--> statement-breakpoint
ALTER TABLE "organisation_entra_tenant" ADD CONSTRAINT "organisation_entra_tenant_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_entra_tenant" ADD CONSTRAINT "organisation_entra_tenant_domain_id_organisation_domain_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."organisation_domain"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_entra_tenant" ADD CONSTRAINT "organisation_entra_tenant_trusted_by_app_user_id_fk" FOREIGN KEY ("trusted_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organisation_entra_tenant_tenant_key" ON "organisation_entra_tenant" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "organisation_entra_tenant_domain_idx" ON "organisation_entra_tenant" USING btree ("domain_id");--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_entra_subject_unique" UNIQUE("entra_subject");