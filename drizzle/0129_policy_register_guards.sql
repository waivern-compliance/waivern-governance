-- Tenant isolation, as for every table that carries its organisation (0052).
ALTER TABLE "policy" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "policy"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
--> statement-breakpoint
ALTER TABLE "policy_version" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "policy_version"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
--> statement-breakpoint
ALTER TABLE "policy_activity" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "policy_activity"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
--> statement-breakpoint
ALTER TABLE "policy_ai_system" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "policy_ai_system"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
--> statement-breakpoint
-- A version belongs to a policy of its own organisation, and names a file
-- attached to that policy. A foreign key proves the row exists, not whose it
-- is: the services check, and this holds when a query does not.
CREATE FUNCTION policy_version_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  policy_org uuid;
BEGIN
  SELECT organisation_id INTO policy_org FROM policy WHERE id = NEW.policy_id;
  IF policy_org IS DISTINCT FROM NEW.organisation_id THEN
    RAISE EXCEPTION 'A policy version belongs to a policy of its own organisation'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM document
     WHERE id = NEW.document_id
       AND subject_type = 'policy'
       AND subject_id = NEW.policy_id
  ) THEN
    RAISE EXCEPTION 'A policy version names a file attached to its own policy'
      USING ERRCODE = 'check_violation';
  END IF;
  -- What was decided stays as it was decided. An approved version may only
  -- be superseded by a later one. The file or a person it names may be
  -- deleted, which empties the reference and keeps the labels: the service
  -- refuses to remove a decided version's file, so that happens only as
  -- records are erased. Nothing else about a decided version moves.
  IF TG_OP = 'UPDATE' AND OLD.status IN ('approved', 'rejected', 'superseded') THEN
    IF (NEW.label, NEW.changes, NEW.approval_reference, NEW.rejection_reason,
        NEW.drafted_by_label, NEW.submitted_by_label, NEW.submitted_at,
        NEW.decided_by_label, NEW.decided_at)
       IS DISTINCT FROM
       (OLD.label, OLD.changes, OLD.approval_reference, OLD.rejection_reason,
        OLD.drafted_by_label, OLD.submitted_by_label, OLD.submitted_at,
        OLD.decided_by_label, OLD.decided_at)
       OR (NEW.document_id IS DISTINCT FROM OLD.document_id AND NEW.document_id IS NOT NULL)
       OR (NEW.submitted_by_user_id IS DISTINCT FROM OLD.submitted_by_user_id AND NEW.submitted_by_user_id IS NOT NULL)
       OR (NEW.decided_by_user_id IS DISTINCT FROM OLD.decided_by_user_id AND NEW.decided_by_user_id IS NOT NULL)
       OR (NEW.status IS DISTINCT FROM OLD.status
           AND NOT (OLD.status = 'approved' AND NEW.status = 'superseded'
                    AND NEW.superseded_at IS NOT NULL))
       OR (NEW.superseded_at IS DISTINCT FROM OLD.superseded_at
           AND NOT (OLD.status = 'approved' AND NEW.status = 'superseded'))
    THEN
      RAISE EXCEPTION 'A decided policy version cannot be changed'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER policy_version_guard
  BEFORE INSERT OR UPDATE ON "policy_version"
  FOR EACH ROW EXECUTE FUNCTION policy_version_guard();
--> statement-breakpoint
-- A link joins a policy to an activity or AI system of its own organisation,
-- and of its own legal entity unless the policy is for every entity.
CREATE FUNCTION policy_link_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  policy_org uuid;
  policy_entity uuid;
  target_org uuid;
  target_entity uuid;
BEGIN
  SELECT organisation_id, entity_id INTO policy_org, policy_entity
    FROM policy WHERE id = NEW.policy_id;
  IF TG_TABLE_NAME = 'policy_activity' THEN
    SELECT organisation_id, entity_id INTO target_org, target_entity
      FROM processing_activity WHERE id = NEW.activity_id;
  ELSE
    SELECT organisation_id, entity_id INTO target_org, target_entity
      FROM ai_use_case WHERE id = NEW.ai_use_case_id;
  END IF;
  IF policy_org IS DISTINCT FROM NEW.organisation_id
     OR target_org IS DISTINCT FROM NEW.organisation_id THEN
    RAISE EXCEPTION 'A policy links only to records of its own organisation'
      USING ERRCODE = 'check_violation';
  END IF;
  IF policy_entity IS NOT NULL AND target_entity IS DISTINCT FROM policy_entity THEN
    RAISE EXCEPTION 'A policy for one legal entity links only to that entity''s records'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER policy_activity_guard
  BEFORE INSERT OR UPDATE ON "policy_activity"
  FOR EACH ROW EXECUTE FUNCTION policy_link_guard();
--> statement-breakpoint
CREATE TRIGGER policy_ai_system_guard
  BEFORE INSERT OR UPDATE ON "policy_ai_system"
  FOR EACH ROW EXECUTE FUNCTION policy_link_guard();
