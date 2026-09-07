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

Drizzle with schema push, and no migration files. Edit `lib/db/schema/`, and
Railway applies it by running `drizzle-kit push` when the container starts.

Additive changes land on their own. Destructive ones fail quietly: push runs
without `--force`, so a dropped column waits for a confirmation that never
arrives in a deploy, and the change simply never happens. Apply those by hand
first, then ship a schema that already matches the database.

```bash
bun run db:push      # apply schema
bun run db:studio    # inspect the database
```

## Shared types

`lib/shared/types` is the source of truth for anything both services need.
After changing it, run `bun run sync:types` to copy it into horo-fe, and commit
both repositories.

## Commands

```bash
bun run dev          # hot reloading server
bun test             # 121 tests
bun run type-check   # tsc --noEmit
bun run build        # tests, then build
```

Type checking reports 16 pre existing errors, all of them Elysia header typing
complaints. Treat that number as the baseline: anything above it is yours.

Railway builds and deploys on push to `master`, running schema push at startup.
