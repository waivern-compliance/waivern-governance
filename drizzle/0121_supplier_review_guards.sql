-- A review outcome is one of the three a review can reach, and only an
-- approval with conditions carries them.
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_review_outcome_known"
  CHECK ("review_outcome" IS NULL OR "review_outcome" IN ('approved', 'approved_with_conditions', 'exit'));--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_review_conditions_with_outcome"
  CHECK ("review_conditions" IS NULL OR "review_outcome" = 'approved_with_conditions');--> statement-breakpoint
-- Suppliers tiered before the cycle existed have never been reviewed under
-- it, so their first review is due now rather than never.
UPDATE "supplier" SET "next_review_at" = now()
  WHERE "tier" IS NOT NULL AND "next_review_at" IS NULL;
