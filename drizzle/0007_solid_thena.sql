ALTER TABLE "chart_narratives" ALTER COLUMN "structured_reading" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chart_narratives" DROP COLUMN "narrative";--> statement-breakpoint
ALTER TABLE "chart_narratives" DROP COLUMN "version";