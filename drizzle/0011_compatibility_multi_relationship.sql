-- Expand compatibility table for multi-relationship types
-- Drop profile_b_id FK (partners don't have profiles in our system)
-- Add inline partner data + relationship type

-- Drop old indexes that reference profile_b_id
DROP INDEX IF EXISTS "compatibility_profile_b_idx";

-- Drop the profile_b_id column
ALTER TABLE "compatibility" DROP COLUMN IF EXISTS "profile_b_id";

-- Add new columns
ALTER TABLE "compatibility" ADD COLUMN "partner_name" varchar(255);
ALTER TABLE "compatibility" ADD COLUMN "partner_birth_date" date;
ALTER TABLE "compatibility" ADD COLUMN "relationship_type" varchar(50);
ALTER TABLE "compatibility" ADD COLUMN "user_element" varchar(50);
ALTER TABLE "compatibility" ADD COLUMN "user_day_master" varchar(50);
ALTER TABLE "compatibility" ADD COLUMN "partner_element" varchar(50);
ALTER TABLE "compatibility" ADD COLUMN "partner_day_master" varchar(50);

-- Backfill existing rows (if any)
UPDATE "compatibility" SET
  "partner_name" = 'Unknown',
  "partner_birth_date" = '2000-01-01',
  "relationship_type" = 'romantic'
WHERE "partner_name" IS NULL;

-- Change strengths/challenges from varchar to text
ALTER TABLE "compatibility" ALTER COLUMN "strengths" TYPE text;
ALTER TABLE "compatibility" ALTER COLUMN "challenges" TYPE text;

-- Enforce NOT NULL after backfill
ALTER TABLE "compatibility" ALTER COLUMN "partner_name" SET NOT NULL;
ALTER TABLE "compatibility" ALTER COLUMN "partner_birth_date" SET NOT NULL;
ALTER TABLE "compatibility" ALTER COLUMN "relationship_type" SET NOT NULL;

-- Add new indexes
CREATE INDEX IF NOT EXISTS "compatibility_profile_created_idx" ON "compatibility" ("profile_a_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "compatibility_user_partner_type_idx" ON "compatibility" ("profile_a_id", "partner_birth_date", "relationship_type");
