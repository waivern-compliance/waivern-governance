CREATE TABLE "form_appearance_logo" (
	"appearance_id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"content" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_appearance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"link_id" uuid,
	"show_powered_by" boolean DEFAULT true NOT NULL,
	"accent_colour" text,
	"background" text,
	"logo_sha256" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_appearance_link_id_unique" UNIQUE("link_id")
);
--> statement-breakpoint
ALTER TABLE "form_appearance_logo" ADD CONSTRAINT "form_appearance_logo_appearance_id_form_appearance_id_fk" FOREIGN KEY ("appearance_id") REFERENCES "public"."form_appearance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_appearance_logo" ADD CONSTRAINT "form_appearance_logo_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_appearance" ADD CONSTRAINT "form_appearance_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_appearance" ADD CONSTRAINT "form_appearance_link_id_dsr_intake_link_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."dsr_intake_link"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "form_appearance_default_key" ON "form_appearance" USING btree ("organisation_id") WHERE "form_appearance"."link_id" is null;--> statement-breakpoint
-- Tenant isolation, as for every table that carries its organisation (0052).
ALTER TABLE "form_appearance" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "form_appearance"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
--> statement-breakpoint
ALTER TABLE "form_appearance_logo" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "form_appearance_logo"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
