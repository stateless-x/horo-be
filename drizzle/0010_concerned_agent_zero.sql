ALTER TABLE "chart_narratives" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "chart_narratives" ALTER COLUMN "updated_at" SET NOT NULL;