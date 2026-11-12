ALTER TABLE "organisation" ADD COLUMN "cookie_lifespan_threshold_months" integer DEFAULT 12 NOT NULL;--> statement-breakpoint
ALTER TABLE "organisation" ADD COLUMN "cookie_lifespan_justification" text;--> statement-breakpoint
ALTER TABLE "digital_property" ADD COLUMN "consent_renewal_months" integer;--> statement-breakpoint
ALTER TABLE "digital_property" ADD COLUMN "consent_renewal_justification" text;--> statement-breakpoint
ALTER TABLE "digital_property" ADD COLUMN "banner_checks" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_decision" ADD COLUMN "law" text DEFAULT 'uk' NOT NULL;