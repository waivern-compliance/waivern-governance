ALTER TABLE "data_subject_request" ADD COLUMN "told_complaint_to" text;--> statement-breakpoint
ALTER TABLE "data_protection_complaint_event" ADD COLUMN "authority" text;--> statement-breakpoint
ALTER TABLE "data_protection_complaint" ADD COLUMN "told_regulator" text;--> statement-breakpoint
-- Established in the UK means subject to the UK GDPR, so an entity under EU law only is not.
UPDATE "entity" SET "uk_establishment" = false WHERE "data_protection_law" = 'eu';