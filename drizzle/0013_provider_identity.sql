ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "providerEmail" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "authProvider" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "signupSource" text;

-- Existing users may already have Google and X linked to the same Better Auth
-- user. Keep the earliest social account on the current user so its profile,
-- readings, and analytics stay with the provider that signed up first. Move
-- every later provider account to a new empty user.
DO $$
DECLARE
  linked_account RECORD;
  new_user_id text;
  real_email text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT "userId", MIN("createdAt") AS first_created_at
      FROM "account"
      WHERE "providerId" IN ('google', 'twitter')
      GROUP BY "userId"
      HAVING COUNT(DISTINCT "providerId") > 1
    ) AS linked
    JOIN "account" AS first_accounts
      ON first_accounts."userId" = linked."userId"
      AND first_accounts."createdAt" = linked.first_created_at
      AND first_accounts."providerId" IN ('google', 'twitter')
    GROUP BY linked."userId"
    HAVING COUNT(DISTINCT first_accounts."providerId") > 1
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot split Google/X history: multiple providers share the earliest account creation time',
      HINT = 'Resolve the tied account.createdAt values before rerunning migration 0013_provider_identity';
  END IF;

  DELETE FROM "session"
  WHERE "userId" IN (
    SELECT "userId"
    FROM "account"
    WHERE "providerId" IN ('google', 'twitter')
    GROUP BY "userId"
    HAVING COUNT(DISTINCT "providerId") > 1
  );

  FOR linked_account IN
    WITH multi_provider_users AS (
      SELECT "userId"
      FROM "account"
      WHERE "providerId" IN ('google', 'twitter')
      GROUP BY "userId"
      HAVING COUNT(DISTINCT "providerId") > 1
    ),
    ranked_social_accounts AS (
      SELECT
        a.id,
        a."userId",
        a."providerId",
        a."accountId",
        a."createdAt",
        ROW_NUMBER() OVER (
          PARTITION BY a."userId"
          ORDER BY a."createdAt", a.id
        ) AS signup_order
      FROM "account" AS a
      JOIN multi_provider_users AS m ON m."userId" = a."userId"
      WHERE a."providerId" IN ('google', 'twitter')
    )
    SELECT ranked.*, u.name, u.email, u."providerEmail", u."emailVerified", u.image
    FROM ranked_social_accounts AS ranked
    JOIN "user" AS u ON u.id = ranked."userId"
    WHERE ranked.signup_order > 1
    ORDER BY ranked."userId", ranked.signup_order
  LOOP
    new_user_id := gen_random_uuid()::text;
    real_email := COALESCE(linked_account."providerEmail", linked_account.email);

    INSERT INTO "user" (
      id,
      name,
      email,
      "providerEmail",
      "authProvider",
      "emailVerified",
      image,
      "createdAt",
      "updatedAt",
      "onboardingCompleted",
      "displayName",
      "signupSource"
    ) VALUES (
      new_user_id,
      linked_account.name,
      linked_account."providerId" || '.' || new_user_id || '@auth.saimu.invalid',
      real_email,
      linked_account."providerId",
      linked_account."emailVerified",
      linked_account.image,
      linked_account."createdAt",
      NOW(),
      false,
      NULL,
      NULL
    );

    UPDATE "account"
    SET "userId" = new_user_id, "updatedAt" = NOW()
    WHERE id = linked_account.id;
  END LOOP;
END $$;

WITH single_social_provider AS (
  SELECT
    "userId",
    MIN("providerId") AS provider
  FROM "account"
  WHERE "providerId" IN ('google', 'twitter')
  GROUP BY "userId"
  HAVING COUNT(DISTINCT "providerId") = 1
)
UPDATE "user" AS u
SET
  "providerEmail" = COALESCE(
    u."providerEmail",
    CASE WHEN u.email NOT LIKE '%@auth.saimu.invalid' THEN u.email END
  ),
  "authProvider" = p.provider
FROM single_social_provider AS p
WHERE p."userId" = u.id;
