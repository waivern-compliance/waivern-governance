-- An abandoned draft is set aside for good.
--
-- A draft that is saved is audited, so it is never deleted; abandoning it is
-- how somebody says it will not be published. After that nothing may change
-- it, as with a retired version, so the audit trail's account of what it said
-- stays true. It was never published, so it must not claim to have been.
--
-- Compared as text: the value was added by the previous migration, and
-- PostgreSQL refuses a new enum value as a literal in the same transaction.

CREATE OR REPLACE FUNCTION template_version_freeze()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'published' THEN
    -- Retiring a version is the one permitted transition: it stops new
    -- assessments starting against it without altering what it says.
    IF NEW.status = 'retired'
       AND NEW.definition IS NOT DISTINCT FROM OLD.definition
       AND NEW.version    =  OLD.version
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION
      'template_version % is published and cannot be changed', OLD.id
      USING ERRCODE = 'restrict_violation',
            HINT = 'Create a new draft version instead of editing a published one.';
  END IF;

  IF OLD.status = 'retired' THEN
    RAISE EXCEPTION
      'template_version % is retired and cannot be changed', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status::text = 'abandoned' THEN
    RAISE EXCEPTION
      'template_version % was abandoned and cannot be changed', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
ALTER TABLE template_version
  DROP CONSTRAINT template_version_publish_metadata;
--> statement-breakpoint
ALTER TABLE template_version
  ADD CONSTRAINT template_version_publish_metadata CHECK (
    (status::text IN ('draft', 'abandoned') AND published_at IS NULL) OR
    (status::text IN ('published', 'retired') AND published_at IS NOT NULL)
  );
