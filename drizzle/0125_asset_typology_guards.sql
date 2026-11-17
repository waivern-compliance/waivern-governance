-- Tenant isolation, as for every table that carries its organisation (0052).
ALTER TABLE "asset_type" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "asset_type"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
--> statement-breakpoint
ALTER TABLE "information_asset_contract" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "information_asset_contract"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
--> statement-breakpoint
-- A type has a name and a definition: a type nobody has defined is filled in
-- differently by everyone who uses it. Its key is made from its name, as
-- `assetTypeKeyFrom` makes it, and is never one of the built-in types' keys
-- (`BUILT_IN_ASSET_TYPES`), so an asset's type always means one thing.
ALTER TABLE "asset_type" ADD CONSTRAINT "asset_type_defined"
  CHECK (btrim(label) <> '' AND btrim(definition) <> '');
--> statement-breakpoint
ALTER TABLE "asset_type" ADD CONSTRAINT "asset_type_key_format"
  CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$' AND key NOT IN (
    'system', 'database', 'file_share', 'saas_application', 'paper_archive',
    'device', 'domain', 'certificate', 'software_licence', 'other'));
--> statement-breakpoint
ALTER TABLE "information_asset" ADD CONSTRAINT "information_asset_notice_days"
  CHECK (notice_days IS NULL OR notice_days >= 0);
--> statement-breakpoint
ALTER TABLE "information_asset" ADD CONSTRAINT "information_asset_details_object"
  CHECK (jsonb_typeof(details) = 'object');
--> statement-breakpoint
-- Assets store a type's key, so the key cannot change under them, and a type
-- cannot be deleted while any asset has it. When the organisation itself is
-- deleted its row has already gone, and its assets go with it.
CREATE FUNCTION asset_type_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.key IS DISTINCT FROM OLD.key
       OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id THEN
      RAISE EXCEPTION 'An asset type keeps its key and its organisation'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM organisation WHERE id = OLD.organisation_id)
     AND EXISTS (SELECT 1 FROM information_asset
                 WHERE organisation_id = OLD.organisation_id
                   AND asset_type = OLD.key) THEN
    RAISE EXCEPTION 'An asset type cannot be deleted while assets have it: retire it instead'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_type_guard
  BEFORE UPDATE OR DELETE ON "asset_type"
  FOR EACH ROW EXECUTE FUNCTION asset_type_guard();
--> statement-breakpoint
-- An asset's type is a built-in one or one of its own organisation's.
CREATE FUNCTION information_asset_type_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.asset_type NOT IN (
       'system', 'database', 'file_share', 'saas_application', 'paper_archive',
       'device', 'domain', 'certificate', 'software_licence', 'other')
     AND NOT EXISTS (SELECT 1 FROM asset_type
                     WHERE organisation_id = NEW.organisation_id
                       AND key = NEW.asset_type) THEN
    RAISE EXCEPTION 'An asset''s type is a built-in type or one of its organisation''s own'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER information_asset_type_guard
  BEFORE INSERT OR UPDATE OF asset_type, organisation_id ON "information_asset"
  FOR EACH ROW EXECUTE FUNCTION information_asset_type_guard();
--> statement-breakpoint
-- A contract pays for assets of its own organisation and legal entity, as an
-- asset's other links are to its own entity's records (0117).
CREATE FUNCTION information_asset_contract_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  asset_org uuid;
  asset_entity uuid;
  contract_org uuid;
  contract_entity uuid;
BEGIN
  SELECT organisation_id, entity_id INTO asset_org, asset_entity
    FROM information_asset WHERE id = NEW.asset_id;
  SELECT organisation_id, entity_id INTO contract_org, contract_entity
    FROM supplier_contract WHERE id = NEW.contract_id;
  IF asset_org IS DISTINCT FROM NEW.organisation_id
     OR contract_org IS DISTINCT FROM NEW.organisation_id THEN
    RAISE EXCEPTION 'An information asset links only to records of its own organisation'
      USING ERRCODE = 'check_violation';
  END IF;
  IF contract_entity IS DISTINCT FROM asset_entity THEN
    RAISE EXCEPTION 'An information asset links only to contracts of its own legal entity'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER information_asset_contract_guard
  BEFORE INSERT OR UPDATE ON "information_asset_contract"
  FOR EACH ROW EXECUTE FUNCTION information_asset_contract_guard();
