ALTER TABLE "entity" ADD COLUMN "uk_establishment" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "entity" ADD COLUMN "eu_establishments" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "entity" ADD COLUMN "eu_main_establishment" text;--> statement-breakpoint
ALTER TABLE "entity" ADD COLUMN "eu_lead_authority" text;--> statement-breakpoint
ALTER TABLE "entity" ADD COLUMN "eu_representative" jsonb;--> statement-breakpoint
ALTER TABLE "entity" ADD COLUMN "eu_representative_exemption" text;--> statement-breakpoint
ALTER TABLE "entity" ADD COLUMN "uk_representative" jsonb;--> statement-breakpoint
ALTER TABLE "entity" ADD COLUMN "uk_representative_exemption" text;--> statement-breakpoint
ALTER TABLE "entity" ADD COLUMN "eu_public_body" boolean DEFAULT false NOT NULL;