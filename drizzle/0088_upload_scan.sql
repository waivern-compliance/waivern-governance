ALTER TABLE "document" ADD COLUMN "scanned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "scanner_version" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "quarantined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "quarantine_signature" text;--> statement-breakpoint
CREATE INDEX "document_unscanned_idx" ON "document" USING btree ("organisation_id") WHERE "document"."scanned_at" is null;