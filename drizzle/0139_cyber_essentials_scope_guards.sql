-- Tenant isolation, as for every table that carries its organisation (0052).
ALTER TABLE "cyber_scope" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "cyber_scope"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
--> statement-breakpoint
ALTER TABLE "cyber_scope_entity" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "cyber_scope_entity"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
--> statement-breakpoint
ALTER TABLE "cyber_scope_asset" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "cyber_scope_asset"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
--> statement-breakpoint
-- The values `lib/cyber-essentials` knows. A scope is the whole organisation
-- or a sub-set, and a sub-set says how it is separated (SCOPE.SUBSET_SEGREGATED).
ALTER TABLE "cyber_scope" ADD CONSTRAINT "cyber_scope_kind"
  CHECK (kind IN ('whole_organisation', 'subset')
         AND (kind <> 'subset' OR btrim(coalesce(segregation, '')) <> ''));
--> statement-breakpoint
ALTER TABLE "cyber_scope" ADD CONSTRAINT "cyber_scope_edition"
  CHECK (edition IN ('v3.2', 'v3.3'));
--> statement-breakpoint
ALTER TABLE "cyber_scope" ADD CONSTRAINT "cyber_scope_named"
  CHECK (btrim(name) <> '');
--> statement-breakpoint
-- An asset left out says why, from the reasons the requirements allow
-- (OUT_OF_SCOPE_REASONS), and "other" says what. One in scope needs no reason.
ALTER TABLE "cyber_scope_asset" ADD CONSTRAINT "cyber_scope_asset_reason"
  CHECK (CASE WHEN in_scope THEN reason IS NULL
         ELSE reason IS NOT NULL
              AND reason IN ('subset_segregated', 'no_internet_connectivity',
                              'byod_voice_text_mfa_only', 'third_party_owned',
                              'student_byod', 'home_router_not_supplied',
                              'bespoke_application_component', 'other')
              AND (reason <> 'other' OR btrim(coalesce(note, '')) <> '')
         END);
--> statement-breakpoint
-- A scope covers entities of its own organisation, and places only assets of
-- the entities it covers. A foreign key proves the row exists, not whose it
-- is: the service checks, and this holds when a query does not.
CREATE FUNCTION cyber_scope_link_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  scope_org uuid;
  target_org uuid;
  target_entity uuid;
BEGIN
  SELECT organisation_id INTO scope_org FROM cyber_scope WHERE id = NEW.scope_id;
  IF TG_TABLE_NAME = 'cyber_scope_entity' THEN
    SELECT organisation_id INTO target_org FROM entity WHERE id = NEW.entity_id;
  ELSE
    SELECT organisation_id, entity_id INTO target_org, target_entity
      FROM information_asset WHERE id = NEW.asset_id;
  END IF;
  IF scope_org IS DISTINCT FROM NEW.organisation_id
     OR target_org IS DISTINCT FROM NEW.organisation_id THEN
    RAISE EXCEPTION 'A Cyber Essentials scope links only to records of its own organisation'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_TABLE_NAME = 'cyber_scope_asset' AND NOT EXISTS (
       SELECT 1 FROM cyber_scope_entity
       WHERE scope_id = NEW.scope_id AND entity_id = target_entity) THEN
    RAISE EXCEPTION 'A Cyber Essentials scope places only assets of the entities it covers'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER cyber_scope_entity_guard
  BEFORE INSERT OR UPDATE ON "cyber_scope_entity"
  FOR EACH ROW EXECUTE FUNCTION cyber_scope_link_guard();
--> statement-breakpoint
CREATE TRIGGER cyber_scope_asset_guard
  BEFORE INSERT OR UPDATE ON "cyber_scope_asset"
  FOR EACH ROW EXECUTE FUNCTION cyber_scope_link_guard();
--> statement-breakpoint
-- A scope's home entity is one of its organisation's.
CREATE FUNCTION cyber_scope_home_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM entity
                 WHERE id = NEW.entity_id
                   AND organisation_id = NEW.organisation_id) THEN
    RAISE EXCEPTION 'A Cyber Essentials scope belongs to an entity of its own organisation'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER cyber_scope_home_guard
  BEFORE INSERT OR UPDATE OF entity_id, organisation_id ON "cyber_scope"
  FOR EACH ROW EXECUTE FUNCTION cyber_scope_home_guard();
