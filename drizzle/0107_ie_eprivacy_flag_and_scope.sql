ALTER TABLE "entity" ADD COLUMN "ie_eprivacy" boolean;--> statement-breakpoint
ALTER TABLE "digital_property" ADD COLUMN "eprivacy_scope" text DEFAULT 'uk' NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_activity" ADD COLUMN "eprivacy_scope" text DEFAULT 'uk' NOT NULL;--> statement-breakpoint
-- An entity not under EU law cannot be under the Irish Regulations, so its
-- answer is no. One under EU law is left unanswered: whether S.I. 336/2011
-- applies depends on facts only a person knows.
UPDATE "entity" SET "ie_eprivacy" = false WHERE "data_protection_law" = 'uk';
