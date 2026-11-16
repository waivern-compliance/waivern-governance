ALTER TYPE "public"."record_type" ADD VALUE 'supplier_contract';--> statement-breakpoint
CREATE TABLE "supplier_contract_viewer" (
	"organisation_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "supplier_contract_viewer_contract_id_user_id_pk" PRIMARY KEY("contract_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "supplier_contract" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"title" text NOT NULL,
	"owner_id" uuid,
	"value" numeric(16, 2),
	"currency" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"notice_days" integer,
	"auto_renews" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"ended_at" timestamp with time zone,
	"ended_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier" ADD COLUMN "tier" text;--> statement-breakpoint
ALTER TABLE "supplier" ADD COLUMN "tier_reason" text;--> statement-breakpoint
ALTER TABLE "supplier_contract_viewer" ADD CONSTRAINT "supplier_contract_viewer_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_contract_viewer" ADD CONSTRAINT "supplier_contract_viewer_contract_id_supplier_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."supplier_contract"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_contract_viewer" ADD CONSTRAINT "supplier_contract_viewer_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_contract" ADD CONSTRAINT "supplier_contract_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_contract" ADD CONSTRAINT "supplier_contract_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_contract" ADD CONSTRAINT "supplier_contract_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_contract" ADD CONSTRAINT "supplier_contract_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_contract" ADD CONSTRAINT "supplier_contract_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_contract_viewer_user_idx" ON "supplier_contract_viewer" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_contract_reference" ON "supplier_contract" USING btree ("organisation_id","reference");--> statement-breakpoint
CREATE INDEX "supplier_contract_supplier_idx" ON "supplier_contract" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "supplier_contract_entity_idx" ON "supplier_contract" USING btree ("organisation_id","entity_id");--> statement-breakpoint
CREATE INDEX "supplier_contract_end_idx" ON "supplier_contract" USING btree ("organisation_id","ends_at");