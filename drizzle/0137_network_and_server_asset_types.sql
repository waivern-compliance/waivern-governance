-- Servers and network devices become built-in types (`BUILT_IN_ASSET_TYPES`),
-- because a Cyber Essentials scope is defined by them. An organisation that
-- had already added a type with one of these keys keeps it, with its
-- definition, its expiry setting and its assets: it moves to a key of its own
-- and its name says it is the organisation's own, so nothing about those
-- assets changes and nobody's type disappears. The guard that keeps a type's
-- key fixed is set aside for the move.
ALTER TABLE "asset_type" DISABLE TRIGGER asset_type_guard;
--> statement-breakpoint
UPDATE "asset_type"
   SET key = key || '_own', label = label || ' (own type)', updated_at = now()
 WHERE key IN ('server', 'network_device');
--> statement-breakpoint
ALTER TABLE "asset_type" ENABLE TRIGGER asset_type_guard;
--> statement-breakpoint
UPDATE "information_asset"
   SET asset_type = asset_type || '_own'
 WHERE asset_type IN ('server', 'network_device');
--> statement-breakpoint
ALTER TABLE "asset_type" DROP CONSTRAINT "asset_type_key_format";
--> statement-breakpoint
ALTER TABLE "asset_type" ADD CONSTRAINT "asset_type_key_format"
  CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$' AND key NOT IN (
    'system', 'database', 'file_share', 'saas_application', 'paper_archive',
    'device', 'server', 'network_device', 'domain', 'certificate',
    'software_licence', 'other'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION information_asset_type_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.asset_type NOT IN (
       'system', 'database', 'file_share', 'saas_application', 'paper_archive',
       'device', 'server', 'network_device', 'domain', 'certificate',
       'software_licence', 'other')
     AND NOT EXISTS (SELECT 1 FROM asset_type
                     WHERE organisation_id = NEW.organisation_id
                       AND key = NEW.asset_type) THEN
    RAISE EXCEPTION 'An asset''s type is a built-in type or one of its organisation''s own'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
