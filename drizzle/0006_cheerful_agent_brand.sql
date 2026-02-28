ALTER TABLE "chart_narratives" ADD COLUMN "structured_reading" text;--> statement-breakpoint
ALTER TABLE "chart_narratives" ADD COLUMN "version" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "chart_narratives" ADD COLUMN "updated_at" timestamp;