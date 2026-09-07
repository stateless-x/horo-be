# horo-be

The API behind สายมู. It turns a birth date into a reading: calculates the
Bazi four pillars and the Thai astrological profile deterministically, then asks
a language model to write those numbers up in Thai.

Part of the [horo](https://github.com/stateless-x/horo) system. It owns every
database write and every model call. [horo-fe](https://github.com/stateless-x/horo-fe)
talks only to this service.

## Stack

Elysia on Bun · Drizzle ORM · PostgreSQL · Better Auth · Redis · Zod ·
DeepSeek for generation.

## Setup

```bash
bun install
cp .env.example .env.local   # then fill it in
bun run dev                  # http://localhost:3001
```

| Variable | What it is |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `DEEPSEEK_API_KEY` | Needed to generate readings. Missing it breaks readings only, by design, so auth stays up |
| `DEEPSEEK_MODEL` | Defaults to `deepseek-chat` |
| `OAUTH_BASE_URL` | This service's origin, for auth callbacks |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google sign in |
| `TWITTER_CLIENT_ID` / `TWITTER_CLIENT_SECRET` | X sign in |
| `FRONTEND_URL`, `CORS_ALLOWED_ORIGINS` | Where horo-fe lives |

The four OAuth variables gate startup: without them the service refuses to
boot, because a half configured auth setup means nobody can log in. The model
key is treated differently on purpose, as above.

## How a reading is made

Determinism first, prose second. `lib/astrology` computes the pillars, the
element profile, the Thai day and the category scores from the birth date alone,
with no model involved. Those numbers go into a prompt, and the model writes
around them. It never invents a score.

Prompts live as markdown in `src/lib/prompts/md/`, one file per reading type,
rendered with the chart values substituted in. Editing a reading's wording means
editing that markdown, not TypeScript.

## Layout

```
src/systems/     fortune, compatibility, tarot, content
src/routes/      analytics, onboarding, dev
lib/astrology/   Bazi and Thai calculations, scoring
lib/db/schema/   users, profiles, readings, analytics
lib/shared/      types shared with the frontend
```

## Database

Drizzle with schema push, not migration files. Edit the schema in
`lib/db/schema/`, and Railway applies it by running `drizzle-kit push` when the
container starts.

Additive changes, a new table or column, apply on their own. Destructive changes
do not: push runs without `--force`, so it waits for a confirmation that never
arrives in a non interactive deploy, and the change silently fails to land.
Apply those to the database by hand first, then deploy a schema that already
matches.

```bash
bun run db:push      # apply schema
bun run db:studio    # inspect the database
```

## Shared types

`lib/shared/types` is the source of truth for anything both services need. After
changing it, run `bun run sync:types` to copy it into horo-fe, and commit both.

## Commands

```bash
bun run dev          # hot reloading development server
bun test             # 121 tests
bun run type-check   # tsc --noEmit
bun run build        # runs the tests, then builds
```

Type checking currently reports 16 pre existing errors, all of them Elysia
header typing complaints. That count is the baseline: if you see more, the extra
ones are yours.

## Deployment

Railway builds and deploys on push to `master`, running schema push at startup.
