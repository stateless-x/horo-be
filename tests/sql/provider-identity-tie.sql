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

CREATE TABLE "session" (id text PRIMARY KEY, "userId" text NOT NULL REFERENCES "user"(id));

INSERT INTO "user" (id, name, email) VALUES ('tied', 'Tied', 'tied@example.com');
INSERT INTO "account" (id, "accountId", "providerId", "userId", "createdAt", "updatedAt") VALUES
  ('g-tied', 'g-tied', 'google', 'tied', '2026-01-01', '2026-01-01'),
  ('x-tied', 'x-tied', 'twitter', 'tied', '2026-01-01', '2026-01-01');

\i /migration.sql
