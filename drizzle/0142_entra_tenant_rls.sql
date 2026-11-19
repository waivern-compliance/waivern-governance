-- Each organisation sees and changes only the tenants it trusts. Sign-in finds
-- the organisation that trusts a tenant outside any organisation's scope, as it
-- does for a verified domain.
ALTER TABLE "organisation_entra_tenant" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "organisation_entra_tenant"
  USING (organisation_id = app_current_organisation())
  WITH CHECK (organisation_id = app_current_organisation());
