ALTER TYPE "public"."data_protection_jurisdiction" ADD VALUE 'uk_eu';--> statement-breakpoint
ALTER TABLE "breach_decision" ADD COLUMN "authority_code" text;--> statement-breakpoint
ALTER TABLE "breach" ADD COLUMN "laws" text DEFAULT 'uk' NOT NULL;--> statement-breakpoint
ALTER TABLE "breach" ADD COLUMN "affected_states" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "organisation" DROP COLUMN "data_protection_jurisdiction";--> statement-breakpoint
-- Every breach takes its entity's law; Part 3 is UK law only.
UPDATE "breach" AS b SET "laws" = CASE WHEN b."regime" = 'dpa_part3' THEN 'uk' ELSE e."data_protection_law" END
  FROM "entity" AS e WHERE e."id" = b."entity_id";--> statement-breakpoint
-- A notification decision on a breach under UK law alone can only have gone to the Information Commission.
UPDATE "breach_decision" AS d SET "authority_code" = 'gb-ico'
  FROM "breach" AS b WHERE b."id" = d."breach_id" AND d."kind" = 'supervisory_authority' AND b."laws" = 'uk';
