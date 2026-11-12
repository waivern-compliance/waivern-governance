CREATE TABLE "entity_erasure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"entity_name" text NOT NULL,
	"legal_entity_ref" text,
	"status" text DEFAULT 'requested' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"requested_by" uuid,
	"requested_by_email" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"counts" jsonb,
	"audit_erased" integer
);
--> statement-breakpoint
-- An audit event keeps the id of its entity after the entity is deleted: the
-- hash covers it. The foreign keys go; a new event must still name an entity
-- of its own organisation, now checked when it is written (0053's guard).
ALTER TABLE "audit_event" DROP CONSTRAINT "audit_event_entity_id_entity_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_event" DROP CONSTRAINT "audit_event_entity_id_same_org";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_event_entity_in_organisation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.entity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM entity e
    WHERE e.id = NEW.entity_id AND e.organisation_id = NEW.organisation_id
  ) THEN
    RAISE EXCEPTION 'audit_event names entity % outside its organisation', NEW.entity_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_event_entity_check
  BEFORE INSERT ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_entity_in_organisation();
--> statement-breakpoint
ALTER TABLE "entity_agreement" DROP CONSTRAINT "entity_agreement_entity_id_entity_id_fk";
--> statement-breakpoint
ALTER TABLE "entity_agreement" ALTER COLUMN "entity_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "entity_erasure" ADD CONSTRAINT "entity_erasure_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_erasure" ADD CONSTRAINT "entity_erasure_requested_by_app_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_erasure_token_key" ON "entity_erasure" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "entity_erasure_org_idx" ON "entity_erasure" USING btree ("organisation_id","requested_at");--> statement-breakpoint
ALTER TABLE "entity_agreement" ADD CONSTRAINT "entity_agreement_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Tenant isolation, as for every table that carries its organisation (0052).
ALTER TABLE "entity_erasure" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "entity_erasure"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
--> statement-breakpoint
-- Deleting a legal entity.
--
-- Several tables refuse to let a row go, because they record decisions or
-- history (0001 and later). Deleting an entity is the one thing that may take
-- those rows, and only that entity's: each guard below now lets a row go when
-- the transaction has said, in `govern.entity_erasure`, which deletion it is
-- carrying out, that deletion is marked `erasing`, and the row belongs to the
-- entity it names. Nothing else changes: outside a deletion every guard
-- refuses exactly as before. The audit trail is not among them: its events
-- are kept, with their contents erased through eraseAuditContents (0112).
--
-- `erasing` exists only inside the transaction that deletes, which sets it as
-- its first step and `completed` as its last (services/entity-erasure.ts), so
-- no committed row is ever `erasing` and the setting alone opens nothing.
CREATE OR REPLACE FUNCTION entity_erasure_in_progress() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT e.entity_id
  FROM entity_erasure e
  WHERE e.id = NULLIF(current_setting('govern.entity_erasure', true), '')::uuid
    AND e.status = 'erasing'
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION assessment_revision_is_append_only()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND entity_erasure_in_progress() IS NOT NULL
     AND (SELECT a.entity_id FROM assessment a WHERE a.id = OLD.assessment_id)
         = entity_erasure_in_progress()
  THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'assessment_revision is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation',
          HINT = 'Take a new revision rather than altering an existing one.';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION risk_acceptance_no_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF entity_erasure_in_progress() IS NOT NULL
     AND (SELECT r.entity_id FROM risk r WHERE r.id = OLD.risk_id)
         = entity_erasure_in_progress()
  THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'risk_acceptance is append-only: DELETE is not permitted'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION atrs_record_no_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status <> 'draft'
     AND OLD.entity_id IS DISTINCT FROM entity_erasure_in_progress()
  THEN
    RAISE EXCEPTION 'atrs_record % has been approved and cannot be deleted', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ai_change_append_only()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.entity_id = entity_erasure_in_progress() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'ai_change is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation',
          HINT = 'Record a further change instead.';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ai_assurance_append_only()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.entity_id = entity_erasure_in_progress() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'ai_assurance_record is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation',
          HINT = 'Record the corrected result as a new record.';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Shared by ai_incident and ai_incident_event; an event belongs to the
-- entity of its incident.
CREATE OR REPLACE FUNCTION ai_incident_no_delete()
RETURNS TRIGGER AS $$
DECLARE
  owner uuid;
BEGIN
  IF entity_erasure_in_progress() IS NOT NULL THEN
    IF TG_TABLE_NAME = 'ai_incident' THEN
      owner := (to_jsonb(OLD) ->> 'entity_id')::uuid;
    ELSE
      SELECT i.entity_id INTO owner FROM ai_incident i
      WHERE i.id = (to_jsonb(OLD) ->> 'incident_id')::uuid;
    END IF;
    IF owner = entity_erasure_in_progress() THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION '% is append-only: DELETE is not permitted', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ai_use_case_request_no_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.entity_id = entity_erasure_in_progress() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'ai_use_case_request is kept: DELETE is not permitted'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Shared by entity_agreement and terms_acceptance. An acceptance outlives the
-- entity it was for: the deletion may clear `entity_id` and nothing else.
CREATE OR REPLACE FUNCTION agreement_is_append_only()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'entity_agreement'
     AND entity_erasure_in_progress() IS NOT NULL
     AND (to_jsonb(OLD) ->> 'entity_id')::uuid = entity_erasure_in_progress()
     AND to_jsonb(NEW) ->> 'entity_id' IS NULL
     AND (to_jsonb(NEW) - 'entity_id') = (to_jsonb(OLD) - 'entity_id')
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION
    '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation',
          HINT = 'Record a new acceptance instead of altering an old one.';
END;
$$ LANGUAGE plpgsql;
