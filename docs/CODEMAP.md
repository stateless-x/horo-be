# CODEMAP — horo-be · authentication, astrology, and reading API
Updated: 2026-09-14 · commit `48ce57a` + working tree · Score: **11/12** (ready for scoped fixes; map generation before a model/prompt redesign) [V]

## TL;DR
Elysia/Bun service that owns customer auth, every product database write, deterministic astrology, model generation, analytics writes, and rate limits. [V] `src/index.ts:27-90`
Google and X use different internal identity emails even when their real email matches; account linking is disabled. [V] `src/lib/auth.ts:26-46,69-74`
Profile creation is transactional and per-user locked; migration 0013 splits historical linked providers while preserving the first provider's history. [V] `src/systems/fortune/routes.ts:231-313`, `drizzle/0013_provider_identity.sql:5-128`

## Scores
Purpose 2 · Spine 2 · Domain 1 · Data 2 · Boundaries 2 · Danger 2 [V]
Auth/profile is verified end-to-end; the broader LLM generation domain was not retraced. [V]

## Stack & entry points
- Bun, Elysia, Drizzle ORM, PostgreSQL, Better Auth 1.4.19, Redis, Zod, DeepSeek. [V] `package.json:1-35`
- `src/index.ts` creates the server, mounts auth and route groups, and starts listening. [V] `src/index.ts:27-90`
- Run `bun run dev`; verify with `bun test`, `bun run type-check`, and `bun run build`. [V] `package.json:6-15`
- Tracked suite excluding the known port-0 harness defect: 160 passed; 7 identity-policy tests and 2 PostgreSQL migration fixtures passed on 2026-09-14. [V]

## Spine
1. Better Auth callback maps Google/X provider IDs to deterministic internal identity emails. [V] `src/lib/auth.ts:26-46`, `src/lib/provider-identity.ts:10-20`
2. Better Auth persists provider accounts and returns a cookie session at `/api/auth`. [V] `src/lib/auth.ts:8-20,48-74`
3. Protected fortune routes call the shared Better Auth session validator. [V] `src/lib/session.ts:26-68`, `src/systems/fortune/routes.ts:215-230`
4. `POST /api/fortune/profile` validates the complete profile payload. [V] `src/systems/fortune/routes.ts:215-230`, `lib/shared/types/user.ts:13-20`
5. A PostgreSQL transaction obtains a per-user advisory lock, rechecks profile absence, and writes profile plus both derived charts. [V] `src/systems/fortune/routes.ts:231-289`
6. The same transaction records display name, signup source, and onboarding completion. [V] `src/systems/fortune/routes.ts:291-313`
7. Migration 0013 retains the earliest provider's user ID/history, creates blank users for later providers, and revokes affected sessions. [V] `drizzle/0013_provider_identity.sql:10-128`

## Wiring
- `src/index` -> Better Auth handler — `/api/auth` callbacks/session endpoints. [V] `src/index.ts:69-90`
- `src/index` -> `systemsRoutes` — fortune, compatibility, tarot, content route groups. [V] `src/index.ts:76-90`, `src/systems/index.ts:12-16`
- fortune routes -> session validator — cookie authentication. [V] `src/systems/fortune/routes.ts:215-230`
- fortune routes -> Drizzle transaction — profile and derived astrology writes. [V] `src/systems/fortune/routes.ts:231-313`
- schema -> PostgreSQL — users/accounts plus birth profiles and chart tables. [V] `lib/db/schema/users.ts:12-66`, `lib/db/schema/profiles.ts:4-58`

## Domain core
- Provider ID plus provider account ID is the login identity; real email is reporting data, not a merge key. [V] `src/lib/auth.ts:26-46`, `lib/db/schema/users.ts:16-26`
- Google/X implicit and explicit account linking is disabled. [V] `src/lib/auth.ts:69-74`
- A profile is complete only with name, ISO birth date, and gender; birth time and MBTI are optional. [V] `lib/shared/types/user.ts:13-20`
- A user can have one application-created profile at a time; advisory lock serializes concurrent onboarding tabs. [V] `src/systems/fortune/routes.ts:231-245`
- Historical split is deterministic by `account.createdAt`; tied earliest providers abort instead of guessing history ownership. [V] `drizzle/0013_provider_identity.sql:10-34`

## Data
- Drizzle schemas in `lib/db/schema` are the application source of truth; SQL migrations and journal live under `drizzle/`. [V] `lib/db/schema/index.ts:1-4`, `drizzle/meta/_journal.json`
- Better Auth writes `user`, `account`, `session`, and `verification`; fortune routes write profiles/readings. [V] `lib/db/schema/users.ts:12-78`, `src/systems/fortune/routes.ts:231-313`
- Migration 0013 adds provider reporting fields and repairs previously linked Google/X users. [V] `drizzle/0013_provider_identity.sql:1-128`

## Boundaries
- Public health/root routes always mount; auth and application routes mount only when required config is valid. [V] `src/index.ts:27-83`
- OAuth callbacks are `/api/auth/callback/google` and `/api/auth/callback/twitter`; credentials and allowed origins come from config. [V] `src/lib/auth.ts:26-55`
- Fortune request bodies use Zod schemas and protected routes validate Better Auth sessions. [V] `lib/shared/types/user.ts:13-20`, `src/lib/session.ts:26-68`

## Danger zones
- high · Authenticated users can reset their own rate-limit buckets through a debug route mounted in the production-capable chain. [V] `src/index.ts:111-149`
- high · Docker starts the API concurrently with `db:push` and does not copy ordered migrations, so custom data migrations require a pre-deploy run. [V] `Dockerfile:44-46,58-60`
- medium · `/api/debug/session` echoes the beginning of the caller's cookie header in a JSON response; remove or non-production-gate it. [V] `src/index.ts:92-109`
- medium · `(providerId, accountId)` has a non-unique index although identity lookup assumes one account row. [V] `lib/db/schema/users.ts:46-66`
- Secrets sweep: no key signatures/private keys found; credential-like hits were config variables or development placeholders. [V]
- Sink sweep: Redis `eval` runs fixed local Lua and SQL uses Drizzle parameter binding. [V] `src/lib/rate-limit.ts:172,273`, `src/systems/fortune/routes.ts:235`
- Dependencies: [?] external advisory audit unavailable in this offline recon.
- Bug magnets: one TODO marker in Thai astrology; no empty catches found. [V] `lib/astrology/thai.ts:1`

## Docs verdict
- `README.md` — STALE before this update: claimed no migrations and an obsolete test count. [V]
- `drizzle/README.md` — STALE before this update: stopped at migration 0002 and described push as applying migrations. [V]
- `docs/architecture.md` — TRUST for system routing; auth/profile persistence was previously undocumented. [V]

## Drift
- Requirement: same-email Google and X logins are separate accounts; first provider keeps historical data. [V] user-confirmed 2026-09-13
- Production rollout must run migration 0013 before the new auth mapping; older docs said schema push alone was sufficient. [V] `drizzle/0013_provider_identity.sql:1-128`

## Open questions
- [?] Production count of tied earliest provider timestamps requires one read-only SQL query before deployment (~2 minutes).
- [?] Full LLM prompt/retry map costs about 20 minutes when generation changes next.
