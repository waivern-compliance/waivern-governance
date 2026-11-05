DROP INDEX "entity_agreement_entity_idx";--> statement-breakpoint
DROP INDEX "terms_acceptance_user_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "entity_agreement_entity_idx" ON "entity_agreement" USING btree ("entity_id","terms_version","dpa_version");--> statement-breakpoint
CREATE UNIQUE INDEX "terms_acceptance_user_idx" ON "terms_acceptance" USING btree ("user_id","terms_version");