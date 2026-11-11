ALTER TABLE "entity" ALTER COLUMN "default_regime" SET DEFAULT 'gdpr';--> statement-breakpoint
ALTER TABLE "processing_activity" ALTER COLUMN "regime" SET DEFAULT 'gdpr';--> statement-breakpoint
ALTER TABLE "breach" ALTER COLUMN "regime" SET DEFAULT 'gdpr';--> statement-breakpoint
ALTER TABLE "data_subject_request" ALTER COLUMN "regime" SET DEFAULT 'gdpr';--> statement-breakpoint
ALTER TABLE "processing_activity" ADD COLUMN "laws" text DEFAULT 'uk' NOT NULL;--> statement-breakpoint
-- The general regime is the GDPR, UK or EU as the record's laws say (decision 3).
UPDATE "processing_activity" SET "regime" = 'gdpr' WHERE "regime" = 'uk_gdpr';--> statement-breakpoint
UPDATE "breach" SET "regime" = 'gdpr' WHERE "regime" = 'uk_gdpr';--> statement-breakpoint
UPDATE "data_subject_request" SET "regime" = 'gdpr' WHERE "regime" = 'uk_gdpr';--> statement-breakpoint
UPDATE "entity" SET "default_regime" = 'gdpr' WHERE "default_regime" = 'uk_gdpr';--> statement-breakpoint
-- Every existing record takes its entity's law: for an entity under both, both,
-- which shows more, never less. A person narrows it.
UPDATE "processing_activity" AS a SET "laws" = e."data_protection_law"
  FROM "entity" AS e WHERE e."id" = a."entity_id";
