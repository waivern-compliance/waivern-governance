-- A record that exists only because UK or EU data protection law applies -
-- a processing record, a breach, a request, a complaint, a website or
-- marketing under ePrivacy law, a request form, a sharing agreement, an
-- appropriate policy document - is refused for an entity recorded as under
-- neither (`entity.data_protection_law_applies`). The services refuse first,
-- in words for the person; this holds where a service, an import or an
-- integration does not, since the entity's stored law is dormant and would
-- otherwise put the record under UK law with nobody noticing.
CREATE FUNCTION privacy_record_needs_law() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.entity_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- A freedom of information form is the FOI Act's, not data protection law's.
  IF TG_TABLE_NAME = 'dsr_intake_link' THEN
    IF NEW.kind <> 'data_protection' THEN
      RETURN NEW;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.entity_id IS NOT DISTINCT FROM OLD.entity_id THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM entity
    WHERE id = NEW.entity_id AND NOT data_protection_law_applies
  ) THEN
    RAISE EXCEPTION 'entity % is under neither UK nor EU data protection law, so a % cannot be recorded for it',
      NEW.entity_id, TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER processing_activity_needs_law BEFORE INSERT OR UPDATE OF entity_id ON "processing_activity"
  FOR EACH ROW EXECUTE FUNCTION privacy_record_needs_law();
--> statement-breakpoint
CREATE TRIGGER breach_needs_law BEFORE INSERT OR UPDATE OF entity_id ON "breach"
  FOR EACH ROW EXECUTE FUNCTION privacy_record_needs_law();
--> statement-breakpoint
CREATE TRIGGER data_subject_request_needs_law BEFORE INSERT OR UPDATE OF entity_id ON "data_subject_request"
  FOR EACH ROW EXECUTE FUNCTION privacy_record_needs_law();
--> statement-breakpoint
CREATE TRIGGER data_protection_complaint_needs_law BEFORE INSERT OR UPDATE OF entity_id ON "data_protection_complaint"
  FOR EACH ROW EXECUTE FUNCTION privacy_record_needs_law();
--> statement-breakpoint
CREATE TRIGGER digital_property_needs_law BEFORE INSERT OR UPDATE OF entity_id ON "digital_property"
  FOR EACH ROW EXECUTE FUNCTION privacy_record_needs_law();
--> statement-breakpoint
CREATE TRIGGER marketing_activity_needs_law BEFORE INSERT OR UPDATE OF entity_id ON "marketing_activity"
  FOR EACH ROW EXECUTE FUNCTION privacy_record_needs_law();
--> statement-breakpoint
CREATE TRIGGER dsr_intake_link_needs_law BEFORE INSERT OR UPDATE OF entity_id ON "dsr_intake_link"
  FOR EACH ROW EXECUTE FUNCTION privacy_record_needs_law();
--> statement-breakpoint
CREATE TRIGGER sharing_agreement_needs_law BEFORE INSERT OR UPDATE OF entity_id ON "sharing_agreement"
  FOR EACH ROW EXECUTE FUNCTION privacy_record_needs_law();
--> statement-breakpoint
CREATE TRIGGER policy_document_needs_law BEFORE INSERT OR UPDATE OF entity_id ON "policy_document"
  FOR EACH ROW EXECUTE FUNCTION privacy_record_needs_law();
