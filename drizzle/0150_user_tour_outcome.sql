CREATE TYPE "public"."tour_outcome" AS ENUM('finished', 'dismissed');--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "tour_outcome" "tour_outcome";--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "tour_outcome_at" timestamp with time zone;