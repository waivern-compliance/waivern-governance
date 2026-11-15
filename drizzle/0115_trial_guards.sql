-- Trials.
--
-- Tenant isolation, as for every table that carries its organisation (0052).
ALTER TABLE "trial" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "trial"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
--> statement-breakpoint
ALTER TABLE "trial_request" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "trial_request"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
--> statement-breakpoint
-- A sign-up belongs to no organisation, as an organisation request does not
-- (0055): no organisation's work may read them, and sign-up reads them as the
-- owner.
ALTER TABLE "trial_signup" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A trial reaches no real person but the one trying it.
--
-- Approvals, tasks, mentions and notifications go to an organisation's
-- members. A trial's members are the person trying it and its simulated
-- colleagues, who cannot sign in and are never emailed, so nothing in it can
-- reach anybody else. Invitations are refused in the application; this
-- refuses every other way in as well (joining by a verified domain, an
-- operator's script, a hand-written insert) until a platform administrator
-- converts the trial to a full account.
--
-- SECURITY DEFINER because a person being added is not yet visible to the
-- organisation under row-level security (0052 hides other organisations'
-- people), and the check has to see whether they are simulated.
CREATE OR REPLACE FUNCTION trial_has_one_member() RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM trial t
    WHERE t.organisation_id = NEW.organisation_id
      AND t.status <> 'converted'
      AND t.user_id <> NEW.user_id
  ) AND NOT EXISTS (
    SELECT 1 FROM app_user u WHERE u.id = NEW.user_id AND u.simulated
  ) THEN
    RAISE EXCEPTION 'a trial organisation has only the person trying it as a member'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER membership_trial_one_member
  BEFORE INSERT OR UPDATE OF organisation_id, user_id ON membership
  FOR EACH ROW EXECUTE FUNCTION trial_has_one_member();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION trial_starts_alone() RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status <> 'converted' AND EXISTS (
    SELECT 1 FROM membership m JOIN app_user u ON u.id = m.user_id
    WHERE m.organisation_id = NEW.organisation_id
      AND m.user_id <> NEW.user_id
      AND NOT u.simulated
  ) THEN
    RAISE EXCEPTION 'a trial organisation has only the person trying it as a member'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trial_one_member
  BEFORE INSERT OR UPDATE ON trial
  FOR EACH ROW EXECUTE FUNCTION trial_starts_alone();
--> statement-breakpoint
-- A simulated colleague is never anything else: nobody may sign in as one or
-- turn email on for one, whichever way the row is written.
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_simulated_unreachable"
  CHECK (NOT simulated OR (email LIKE '%@simulated.invalid' AND NOT email_notifications AND sso_subject IS NULL));
