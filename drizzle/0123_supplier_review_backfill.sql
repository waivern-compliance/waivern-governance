-- Due diligence assessments approved before the review cycle existed are
-- supplier reviews too. Without this their suppliers read as never reviewed
-- and due now, and each assessment would still come round on its own
-- schedule and as a lapsed review, as well as through the supplier.
--
-- A due diligence assessment is recognised by the questions it asks, as
-- `isDueDiligenceDefinition` does, so an organisation's own copy counts. The
-- organisation's cycle cannot have been set before this release, so the
-- default months for each tier apply. No audit events are written here: they
-- are hashed by the application, and these changes follow from approvals that
-- are already audited.
CREATE VIEW "supplier_review_backfill" AS
  SELECT a."id", a."organisation_id", a."subject_id" AS "supplier_id",
    a."created_at", coalesce(a."completed_at", a."updated_at") AS "approved_at",
    a."review_due_at", a."review_interval_months",
    CASE rec."value" #>> '{}'
      WHEN 'proceed' THEN 'approved'
      WHEN 'proceed_with_conditions' THEN 'approved_with_conditions'
      WHEN 'do_not_proceed' THEN 'exit'
    END AS "outcome",
    CASE WHEN rec."value" #>> '{}' = 'proceed_with_conditions'
      THEN nullif(btrim(cond."value" #>> '{}'), '')
    END AS "conditions"
  FROM "assessment" a
  JOIN "template_version" tv ON tv."id" = a."template_version_id"
  JOIN "assessment_answer" rec
    ON rec."assessment_id" = a."id" AND rec."question_key" = 'recommendation'
  LEFT JOIN "assessment_answer" cond
    ON cond."assessment_id" = a."id" AND cond."question_key" = 'conditions'
  WHERE a."subject_type" = 'supplier' AND a."subject_id" IS NOT NULL
    AND a."status" = 'approved'
    AND rec."value" #>> '{}' IN ('proceed', 'proceed_with_conditions', 'do_not_proceed')
    AND (
      SELECT count(DISTINCT q ->> 'key')
      FROM jsonb_array_elements(tv."definition" -> 'schema' -> 'sections') s,
        jsonb_array_elements(s -> 'questions') q
      WHERE q ->> 'key' IN ('certifications', 'breach_notification', 'recommendation')
    ) = 3;--> statement-breakpoint
-- The review started last is the supplier's current one, as when approving.
UPDATE "supplier" s SET
    "last_reviewed_at" = r."approved_at",
    "review_outcome" = r."outcome",
    "review_conditions" = r."conditions",
    "review_assessment_id" = r."id",
    "next_review_at" = CASE
      WHEN r."outcome" = 'exit' THEN NULL
      WHEN s."tier" IS NULL THEN r."review_due_at"
      ELSE r."approved_at" + make_interval(months => CASE s."tier"
        WHEN 'critical' THEN 12 WHEN 'high' THEN 12 WHEN 'medium' THEN 24 ELSE 36 END)
    END
  FROM (
    SELECT DISTINCT ON ("supplier_id") * FROM "supplier_review_backfill"
    ORDER BY "supplier_id", "created_at" DESC
  ) r
  WHERE s."id" = r."supplier_id" AND s."organisation_id" = r."organisation_id"
    AND s."review_assessment_id" IS NULL;--> statement-breakpoint
UPDATE "assessment" a SET
    "review_due_at" = s."next_review_at",
    "review_interval_months" = CASE
      WHEN s."review_outcome" = 'exit' THEN NULL
      WHEN s."tier" IS NULL THEN a."review_interval_months"
      ELSE CASE s."tier"
        WHEN 'critical' THEN 12 WHEN 'high' THEN 12 WHEN 'medium' THEN 24 ELSE 36 END
    END
  FROM "supplier" s
  WHERE s."review_assessment_id" = a."id"
    AND a."id" IN (SELECT "id" FROM "supplier_review_backfill");--> statement-breakpoint
-- A supplier review comes round through the supplier, not a schedule of its own.
UPDATE "schedule" SET "is_active" = false
  WHERE "subject_type" = 'assessment'
    AND "subject_id" IN (SELECT "id" FROM "supplier_review_backfill");--> statement-breakpoint
-- Earlier reviews of the same supplier are superseded, with a snapshot in
-- their history of the answers they were approved on.
INSERT INTO "assessment_revision"
    ("assessment_id", "revision", "reason", "answers", "evaluation", "score", "created_by_label")
  SELECT DISTINCT ON (rv."assessment_id")
    rv."assessment_id", rv."revision" + 1, 'superseded', rv."answers", rv."evaluation", rv."score", 'scheduler'
  FROM "assessment_revision" rv
  JOIN "supplier_review_backfill" r ON r."id" = rv."assessment_id"
  JOIN "supplier" s ON s."id" = r."supplier_id"
  WHERE s."review_assessment_id" <> r."id"
  ORDER BY rv."assessment_id", rv."revision" DESC;--> statement-breakpoint
UPDATE "assessment" a SET "status" = 'superseded', "review_due_at" = NULL
  FROM "supplier_review_backfill" r
  JOIN "supplier" s ON s."id" = r."supplier_id"
  WHERE a."id" = r."id" AND s."review_assessment_id" <> r."id";--> statement-breakpoint
DROP VIEW "supplier_review_backfill";
