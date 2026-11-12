-- Scheme 2 of the audit chain: each event's hash covers a digest of its
-- contents (before, after, metadata) rather than the contents themselves, so
-- the contents can be erased and the chain still verifies (lib/audit.ts).
--
-- Existing chains stay on scheme 1 until their next append, which moves them
-- to scheme 2 without rewriting a single existing hash: see appendAuditEvent.
ALTER TABLE "audit_chain_head" ADD COLUMN "scheme" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_chain_head" ALTER COLUMN "scheme" SET DEFAULT 2;--> statement-breakpoint
ALTER TABLE "audit_event" ADD COLUMN "scheme" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_event" ADD COLUMN "content_digest" text;--> statement-breakpoint
ALTER TABLE "audit_event" ADD COLUMN "erased_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "audit_event" ADD COLUMN "erased_by" uuid;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_erased_by_audit_event_id_fk" FOREIGN KEY ("erased_by") REFERENCES "public"."audit_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Every scheme 2 event carries its digest from the start.
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_scheme_digest" CHECK ("scheme" = 1 OR "content_digest" IS NOT NULL);--> statement-breakpoint
-- The only updates the database allows on audit_event, and still no delete:
--
-- 1. Moving a scheme 1 chain to scheme 2 records each old event's digest,
--    once, changing nothing else, inside the transaction that declares it
--    (govern.audit_conversion names the organisation). A wrong digest would
--    not match the contents, and the scheme_changed event commits to them all.
-- 2. Erasing an event's contents: before and after cleared, metadata emptied,
--    digest and everything else kept, naming the audit.contents_erased event
--    of the same organisation that lists this event's sequence number.
CREATE OR REPLACE FUNCTION audit_event_is_append_only()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'content_digest') = (to_jsonb(OLD) - 'content_digest')
     AND OLD.scheme = 1
     AND OLD.content_digest IS NULL
     AND NEW.content_digest IS NOT NULL
     AND current_setting('govern.audit_conversion', true) = OLD.organisation_id::text
  THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.erased_at IS NULL
     AND OLD.content_digest IS NOT NULL
     AND NEW.erased_at IS NOT NULL
     AND NEW.before IS NULL
     AND NEW.after IS NULL
     AND NEW.metadata = '{}'::jsonb
     AND (to_jsonb(NEW) - ARRAY['before', 'after', 'metadata', 'erased_at', 'erased_by'])
         = (to_jsonb(OLD) - ARRAY['before', 'after', 'metadata', 'erased_at', 'erased_by'])
     AND EXISTS (
       SELECT 1 FROM audit_event e
       WHERE e.id = NEW.erased_by
         AND e.organisation_id = OLD.organisation_id
         AND e.action = 'audit.contents_erased'
         AND (e.metadata -> 'seqs') @> to_jsonb(OLD.seq)
     )
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'audit_event is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation',
          HINT = 'Record a compensating event instead of altering history.';
END;
$$ LANGUAGE plpgsql;
