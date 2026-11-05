-- Acceptances of the terms and the Data Processing Agreement are evidence.
--
-- Waivern has to be able to show, years later, who accepted which version of
-- which document and when. Rows are only ever added: accepting a new version
-- adds a row, and nothing may rewrite or remove an old one, so the database
-- refuses both rather than relying on the application not to try.

CREATE OR REPLACE FUNCTION agreement_is_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation',
          HINT = 'Record a new acceptance instead of altering an old one.';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER terms_acceptance_no_update
  BEFORE UPDATE OR DELETE ON terms_acceptance
  FOR EACH ROW EXECUTE FUNCTION agreement_is_append_only();
--> statement-breakpoint
CREATE TRIGGER entity_agreement_no_update
  BEFORE UPDATE OR DELETE ON entity_agreement
  FOR EACH ROW EXECUTE FUNCTION agreement_is_append_only();
--> statement-breakpoint

-- Somebody accepting for an entity must have said they may bind it.
ALTER TABLE entity_agreement
  ADD CONSTRAINT entity_agreement_authority_confirmed CHECK (authority_confirmed);
--> statement-breakpoint

-- An entity's agreement is its organisation's, like the rest of its records.
ALTER TABLE "entity_agreement" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "entity_agreement"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
--> statement-breakpoint

-- A person's own acceptance is the platform's: no organisation's work reads it.
ALTER TABLE "terms_acceptance" ENABLE ROW LEVEL SECURITY;
