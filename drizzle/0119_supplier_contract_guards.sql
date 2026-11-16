-- Tenant isolation, as for every table that carries its organisation (0052).
ALTER TABLE "supplier_contract" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "supplier_contract"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
--> statement-breakpoint
ALTER TABLE "supplier_contract_viewer" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "supplier_contract_viewer"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_tier_known"
  CHECK (tier IS NULL OR tier IN ('critical', 'high', 'medium', 'low'));
--> statement-breakpoint
ALTER TABLE "supplier_contract" ADD CONSTRAINT "supplier_contract_currency_iso"
  CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$');
--> statement-breakpoint
ALTER TABLE "supplier_contract" ADD CONSTRAINT "supplier_contract_notice_days"
  CHECK (notice_days IS NULL OR notice_days >= 0);
--> statement-breakpoint
-- A contract is with one of the organisation's suppliers, signed by one of its
-- entities; a named viewer is one of its members. Foreign keys prove the rows
-- exist, not whose they are: the services check, and this holds when a query
-- does not.
CREATE FUNCTION supplier_contract_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'supplier_contract' THEN
    IF NOT EXISTS (SELECT 1 FROM supplier
                   WHERE id = NEW.supplier_id AND organisation_id = NEW.organisation_id)
       OR NOT EXISTS (SELECT 1 FROM entity
                      WHERE id = NEW.entity_id AND organisation_id = NEW.organisation_id) THEN
      RAISE EXCEPTION 'A contract is with a supplier, and signed by an entity, of its own organisation'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM supplier_contract
                   WHERE id = NEW.contract_id AND organisation_id = NEW.organisation_id)
       OR NOT EXISTS (SELECT 1 FROM membership
                      WHERE user_id = NEW.user_id AND organisation_id = NEW.organisation_id) THEN
      RAISE EXCEPTION 'Only a member of the organisation can be allowed to see a contract''s terms'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER supplier_contract_guard
  BEFORE INSERT OR UPDATE ON "supplier_contract"
  FOR EACH ROW EXECUTE FUNCTION supplier_contract_guard();
--> statement-breakpoint
CREATE TRIGGER supplier_contract_viewer_guard
  BEFORE INSERT OR UPDATE ON "supplier_contract_viewer"
  FOR EACH ROW EXECUTE FUNCTION supplier_contract_guard();
