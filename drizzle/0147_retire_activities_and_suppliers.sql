ALTER TABLE "processing_activity" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "processing_activity" ADD COLUMN "retired_by" uuid;--> statement-breakpoint
ALTER TABLE "processing_activity" ADD COLUMN "retired_reason" text;--> statement-breakpoint
ALTER TABLE "processing_activity" ADD COLUMN "retired_note" text;--> statement-breakpoint
ALTER TABLE "supplier" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier" ADD COLUMN "retired_by" uuid;--> statement-breakpoint
ALTER TABLE "supplier" ADD COLUMN "retired_reason" text;--> statement-breakpoint
ALTER TABLE "supplier" ADD COLUMN "retired_note" text;--> statement-breakpoint
ALTER TABLE "processing_activity" ADD CONSTRAINT "processing_activity_retired_by_app_user_id_fk" FOREIGN KEY ("retired_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_retired_by_app_user_id_fk" FOREIGN KEY ("retired_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;