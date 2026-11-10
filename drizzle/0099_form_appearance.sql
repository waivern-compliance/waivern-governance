CREATE TABLE "intake_form_logo" (
	"link_id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"content" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dsr_intake_link" ADD COLUMN "show_powered_by" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "dsr_intake_link" ADD COLUMN "accent_colour" text;--> statement-breakpoint
ALTER TABLE "dsr_intake_link" ADD COLUMN "background" text;--> statement-breakpoint
ALTER TABLE "dsr_intake_link" ADD COLUMN "logo_sha256" text;--> statement-breakpoint
ALTER TABLE "intake_form_logo" ADD CONSTRAINT "intake_form_logo_link_id_dsr_intake_link_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."dsr_intake_link"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_form_logo" ADD CONSTRAINT "intake_form_logo_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Tenant isolation, as for every table that carries its organisation (0052).
ALTER TABLE "intake_form_logo" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "intake_form_logo"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
