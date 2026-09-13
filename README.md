# horo-be

The API behind สายมู. It turns a birth date into a reading: the Bazi four
pillars and the Thai astrological profile are calculated exactly, then a
language model writes those numbers up in Thai.

Part of the [horo](https://github.com/stateless-x/horo) system. It owns every
database write and every model call, so [horo-fe](https://github.com/stateless-x/horo-fe)
talks to nothing else.

Elysia on Bun · Drizzle ORM · PostgreSQL · Better Auth · Redis · Zod ·
DeepSeek.

## Setup

```bash
bun install
cp .env.example .env.local   # then fill it in
bun run dev                  # http://localhost:3001
```

| Variable | What it is |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `OAUTH_BASE_URL` | This service's origin, for auth callbacks |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google sign in |
| `TWITTER_CLIENT_ID` / `TWITTER_CLIENT_SECRET` | X sign in |
| `DEEPSEEK_API_KEY` | Generation. See below |
| `DEEPSEEK_MODEL` | Defaults to `deepseek-chat` |
| `FRONTEND_URL`, `CORS_ALLOWED_ORIGINS` | Where horo-fe lives |

The four OAuth variables gate startup: without them the service refuses to
boot, because half configured auth means nobody can log in. The model key is
treated differently on purpose. Lose it and readings break while login keeps
working.

## How a reading is made

The maths come first and the prose second. `lib/astrology` derives the pillars,
the element profile, the Thai day and the category scores from the birth date
alone, with no model involved. Those values go into the prompt, and the model
writes around them. It never invents a score.

Prompts are markdown, one file per reading type, in `src/lib/prompts/md/`, with
chart values substituted in at render time. Changing how a reading sounds means
editing markdown, not TypeScript.

```
src/systems/     fortune, compatibility, tarot, content
src/routes/      analytics, onboarding, dev
lib/astrology/   Bazi and Thai calculations, scoring
lib/db/schema/   users, profiles, readings, analytics
lib/shared/      types shared with the frontend
```

## The database

Drizzle schemas live in `lib/db/schema/`; ordered SQL migrations and their
journal live in `drizzle/`. Use migrations for production rollout, especially
when a change includes data repair. `db:push` is for local schema exploration,
not a replacement for running checked-in production migrations.

```bash
bun run db:generate  # generate a migration after a schema change
bun run db:migrate   # apply checked-in migrations
bun run db:push      # synchronize a development database
bun run db:studio    # inspect the database
```

Migration `0013_provider_identity.sql` must run before the provider-aware auth
configuration deploys. It keeps the earliest Google/X provider on the existing
user and history, moves later providers to fresh users, and stops rather than
guessing when the earliest provider timestamps are tied.

## Authentication and profile invariants

Google and X are independent identities even when they return the same real
email. Better Auth receives a deterministic provider-scoped internal email;
`providerEmail` stores the real address for reporting, and account linking is
disabled.

Creating a birth profile, Bazi chart, Thai astrology row, display name, signup
source, and onboarding flag is one PostgreSQL transaction. A per-user advisory
lock serializes concurrent onboarding tabs. Any failure rolls back the complete
write, leaving the account in setup rather than partially completed.

## Shared types

`lib/shared/types` is the source of truth for anything both services need.
After changing it, run `bun run sync:types` to copy it into horo-fe, and commit
both repositories.

## Commands

```bash
bun run dev          # hot reloading server
bun test             # run the current suite
bun run test:migration:provider-identity # verify provider split/abort on PostgreSQL 16
bun run type-check   # tsc --noEmit
bun run build        # tests, then build
```

Type checking reports 16 pre existing errors, all of them Elysia header typing
complaints. Treat that number as the baseline: anything above it is yours.

Railway builds and deploys on push to `master`. Apply pending production
migrations before code that reads their new columns.
