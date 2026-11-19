ALTER TYPE "public"."record_type" ADD VALUE 'cyber_scope';--> statement-breakpoint
CREATE TABLE "cyber_scope_asset" (
	"organisation_id" uuid NOT NULL,
	"scope_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"in_scope" boolean NOT NULL,
	"reason" text,
	"note" text,
	CONSTRAINT "cyber_scope_asset_scope_id_asset_id_pk" PRIMARY KEY("scope_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "cyber_scope_entity" (
	"organisation_id" uuid NOT NULL,
	"scope_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	CONSTRAINT "cyber_scope_entity_scope_id_entity_id_pk" PRIMARY KEY("scope_id","entity_id")
);
--> statement-breakpoint
CREATE TABLE "cyber_scope" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"boundary" text,
	"segregation" text,
	"exclusions" text,
	"edition" text NOT NULL,
	"owner_id" uuid,
	"next_review_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organisation" ADD COLUMN "cyber_essentials" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cyber_scope_asset" ADD CONSTRAINT "cyber_scope_asset_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cyber_scope_asset" ADD CONSTRAINT "cyber_scope_asset_scope_id_cyber_scope_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."cyber_scope"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cyber_scope_asset" ADD CONSTRAINT "cyber_scope_asset_asset_id_information_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."information_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cyber_scope_entity" ADD CONSTRAINT "cyber_scope_entity_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cyber_scope_entity" ADD CONSTRAINT "cyber_scope_entity_scope_id_cyber_scope_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."cyber_scope"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cyber_scope_entity" ADD CONSTRAINT "cyber_scope_entity_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cyber_scope" ADD CONSTRAINT "cyber_scope_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cyber_scope" ADD CONSTRAINT "cyber_scope_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cyber_scope" ADD CONSTRAINT "cyber_scope_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cyber_scope_asset_asset_idx" ON "cyber_scope_asset" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "cyber_scope_entity_entity_idx" ON "cyber_scope_entity" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cyber_scope_reference" ON "cyber_scope" USING btree ("organisation_id","reference");--> statement-breakpoint
CREATE INDEX "cyber_scope_entity_idx" ON "cyber_scope" USING btree ("organisation_id","entity_id");