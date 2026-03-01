-- Add optional MBTI personality type to birth profiles
-- Nullable: null means user doesn't know / hasn't provided their MBTI
ALTER TABLE "birth_profiles" ADD COLUMN "mbti_type" varchar(10);