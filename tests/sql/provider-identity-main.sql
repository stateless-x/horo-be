\set ON_ERROR_STOP on

CREATE TABLE "user" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  "emailVerified" boolean DEFAULT false NOT NULL,
  image text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  "onboardingCompleted" boolean DEFAULT false NOT NULL,
  "displayName" text
);

CREATE TABLE "account" (
  id text PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user"(id),
  "createdAt" timestamp NOT NULL,
  "updatedAt" timestamp NOT NULL
);

CREATE TABLE "session" (
  id text PRIMARY KEY,
  "userId" text NOT NULL REFERENCES "user"(id)
);

CREATE TABLE birth_profiles (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id)
);

CREATE TABLE daily_readings (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES birth_profiles(id)
);

INSERT INTO "user" (id, name, email, "emailVerified", "onboardingCompleted", "displayName") VALUES
  ('x-first', 'X first', 'same-x@example.com', true, true, 'X profile'),
  ('g-first', 'Google first', 'same-g@example.com', true, true, 'Google profile'),
  ('single-x', 'Single X', 'single@example.com', true, true, 'Single profile');

INSERT INTO "account" (id, "accountId", "providerId", "userId", "createdAt", "updatedAt") VALUES
  ('x-old', 'x-1', 'twitter', 'x-first', '2026-01-01', '2026-01-01'),
  ('g-later', 'g-1', 'google', 'x-first', '2026-02-01', '2026-02-01'),
  ('g-old', 'g-2', 'google', 'g-first', '2026-01-01', '2026-01-01'),
  ('x-later', 'x-2', 'twitter', 'g-first', '2026-02-01', '2026-02-01'),
  ('x-only', 'x-3', 'twitter', 'single-x', '2026-01-01', '2026-01-01');

INSERT INTO "session" (id, "userId") VALUES
  ('sx', 'x-first'), ('sg', 'g-first'), ('ss', 'single-x');

INSERT INTO birth_profiles (id, user_id) VALUES
  ('00000000-0000-0000-0000-000000000001', 'x-first'),
  ('00000000-0000-0000-0000-000000000002', 'g-first');

INSERT INTO daily_readings (id, profile_id) VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002');

\i /migration.sql

DO $$
DECLARE
  fresh_google text;
  fresh_twitter text;
BEGIN
  SELECT "userId" INTO fresh_google FROM "account" WHERE id = 'g-later';
  SELECT "userId" INTO fresh_twitter FROM "account" WHERE id = 'x-later';

  IF (SELECT "userId" FROM "account" WHERE id = 'x-old') <> 'x-first' THEN
    RAISE EXCEPTION 'X-first account did not retain its original user';
  END IF;
  IF (SELECT "userId" FROM "account" WHERE id = 'g-old') <> 'g-first' THEN
    RAISE EXCEPTION 'Google-first account did not retain its original user';
  END IF;
  IF fresh_google = 'x-first' OR fresh_twitter = 'g-first' THEN
    RAISE EXCEPTION 'Later provider was not split into a fresh user';
  END IF;
  IF EXISTS (SELECT 1 FROM birth_profiles WHERE user_id IN (fresh_google, fresh_twitter)) THEN
    RAISE EXCEPTION 'Existing profile leaked into a fresh provider user';
  END IF;
  IF (SELECT count(*) FROM birth_profiles WHERE user_id IN ('x-first', 'g-first')) <> 2 THEN
    RAISE EXCEPTION 'First-provider profiles were not retained';
  END IF;
  IF (SELECT count(*) FROM daily_readings) <> 2 THEN
    RAISE EXCEPTION 'First-provider reading history was not retained';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "user"
    WHERE id IN (fresh_google, fresh_twitter)
      AND ("onboardingCompleted" OR "displayName" IS NOT NULL OR "signupSource" IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Fresh provider user inherited onboarding data';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "user"
    WHERE id = fresh_google AND "authProvider" = 'google'
      AND "providerEmail" = 'same-x@example.com'
      AND email LIKE 'google.%@auth.saimu.invalid'
  ) THEN
    RAISE EXCEPTION 'Fresh Google identity is incorrect';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "user"
    WHERE id = fresh_twitter AND "authProvider" = 'twitter'
      AND "providerEmail" = 'same-g@example.com'
      AND email LIKE 'twitter.%@auth.saimu.invalid'
  ) THEN
    RAISE EXCEPTION 'Fresh X identity is incorrect';
  END IF;
  IF EXISTS (SELECT 1 FROM "session" WHERE "userId" IN ('x-first', 'g-first')) THEN
    RAISE EXCEPTION 'Affected linked-account sessions were not revoked';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "session" WHERE "userId" = 'single-x') THEN
    RAISE EXCEPTION 'Unaffected session was revoked';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "user"
    WHERE id = 'single-x' AND "authProvider" = 'twitter'
      AND "providerEmail" = 'single@example.com'
  ) THEN
    RAISE EXCEPTION 'Single-provider backfill is incorrect';
  END IF;
END $$;

SELECT 'provider migration: both signup orders passed' AS result;
