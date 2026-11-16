-- Tenant isolation, as for every table that carries its organisation (0052).
ALTER TABLE "information_asset" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "information_asset"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
--> statement-breakpoint
ALTER TABLE "information_asset_activity" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "information_asset_activity"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
--> statement-breakpoint
ALTER TABLE "information_asset_supplier" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "information_asset_supplier"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
--> statement-breakpoint
ALTER TABLE "information_asset_risk" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "information_asset_risk"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
--> statement-breakpoint
-- A link joins two records of one organisation, and an activity or risk of
-- the asset's own legal entity. A foreign key proves the row exists, not
-- whose it is, and row-level security checks only the link's own column: the
-- services check, and this holds when a query does not.
CREATE FUNCTION information_asset_link_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  asset_org uuid;
  asset_entity uuid;
  target_org uuid;
  target_entity uuid;
BEGIN
  SELECT organisation_id, entity_id INTO asset_org, asset_entity
    FROM information_asset WHERE id = NEW.asset_id;
  IF TG_TABLE_NAME = 'information_asset_activity' THEN
    SELECT organisation_id, entity_id INTO target_org, target_entity
      FROM processing_activity WHERE id = NEW.activity_id;
  ELSIF TG_TABLE_NAME = 'information_asset_risk' THEN
    SELECT organisation_id, entity_id INTO target_org, target_entity
      FROM risk WHERE id = NEW.risk_id;
  ELSE
    SELECT organisation_id INTO target_org
      FROM supplier WHERE id = NEW.supplier_id;
    target_entity := asset_entity;
  END IF;
  IF asset_org IS DISTINCT FROM NEW.organisation_id
     OR target_org IS DISTINCT FROM NEW.organisation_id THEN
    RAISE EXCEPTION 'An information asset links only to records of its own organisation'
      USING ERRCODE = 'check_violation';
  END IF;
  IF target_entity IS DISTINCT FROM asset_entity THEN
    RAISE EXCEPTION 'An information asset links only to activities and risks of its own legal entity'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER information_asset_activity_guard
  BEFORE INSERT OR UPDATE ON "information_asset_activity"
  FOR EACH ROW EXECUTE FUNCTION information_asset_link_guard();
--> statement-breakpoint
CREATE TRIGGER information_asset_supplier_guard
  BEFORE INSERT OR UPDATE ON "information_asset_supplier"
  FOR EACH ROW EXECUTE FUNCTION information_asset_link_guard();
--> statement-breakpoint
CREATE TRIGGER information_asset_risk_guard
  BEFORE INSERT OR UPDATE ON "information_asset_risk"
  FOR EACH ROW EXECUTE FUNCTION information_asset_link_guard();
--> statement-breakpoint
-- The classification scheme cannot change under classified assets in use.
-- A retired asset cannot be edited, so it keeps its label and does not count.
CREATE FUNCTION asset_classification_scheme_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.asset_classification_scheme IS DISTINCT FROM OLD.asset_classification_scheme
     AND EXISTS (SELECT 1 FROM information_asset
                 WHERE organisation_id = NEW.id AND classification IS NOT NULL
                   AND retired_at IS NULL) THEN
    RAISE EXCEPTION 'Assets are already classified on the current scheme'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_classification_scheme_guard
  BEFORE UPDATE OF asset_classification_scheme ON "organisation"
  FOR EACH ROW EXECUTE FUNCTION asset_classification_scheme_guard();
