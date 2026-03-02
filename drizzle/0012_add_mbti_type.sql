-- Add optional MBTI personality type to birth profiles
-- Nullable: null means user doesn't know / hasn't provided their MBTI
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'birth_profiles' AND column_name = 'mbti_type'
  ) THEN
    ALTER TABLE "birth_profiles" ADD COLUMN "mbti_type" varchar(10);
  END IF;
END $$;
