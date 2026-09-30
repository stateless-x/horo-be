---
type: REFERENCE
status: active
scope: product feature flags — storage, rules, admin page, local use
last_reviewed: 2026-09-30
owner: backend
supersedes: [COMPAT_LOCK_ENABLED and COMPAT_UNLOCK_FREE env vars]
superseded_by: null
---

# Feature flags

Product switches live in the `feature_flags` table and are set from horo-admin (สวิตช์ฟีเจอร์, `/flags`). No env var
sets them. Turning paid ดวงคู่ on or off is a product decision, not a redeploy.

## The flags

| Key | Parent | On means |
|---|---|---|
| `compat_lock` | — | A new ดวงคู่ check writes the free teaser; the full report costs 49 มู. The wallet, welcome gift and top-up exist. Off: a check writes the full report free and `GET /api/wallet` answers `{ enabled: false }`. |
| `compat_unlock_free` | `compat_lock` | Every unlock is free (no มู spent). For testing only; never leave it on while selling. |

The keys, labels and descriptions are defined once in `src/lib/feature-flags.ts` (`FEATURE_FLAGS`). The admin page
reads them from the API, so adding a flag there shows it in horo-admin with no admin change.

## Rules

- **A missing row is off.** A fresh database is the old "env var unset" state.
- **A sub-flag applies only while its parent is on.** `readFlags()` returns the effective value (`sub && parent`).
- **Turning a parent off turns its subs off,** in the same transaction. Turning the parent back on does not bring
  a risky sub (free unlocks) back with it.
- **A sub cannot be turned on while its parent is off:** `PUT` answers 409.
- **Reads are cached 5 s per process.** A write clears the writing process's cache at once, and any other process
  sees it within 5 s.
- **A database failure throws.** A flag is never silently read as off.

## Routes (horo-admin only)

Mounted only when `ADMIN_API_SECRET` is set, behind the same `x-admin-secret` check as `/internal/campaigns`
(`src/lib/admin-secret.ts`):

- `GET /internal/flags/` returns `{ flags: [{ key, parent, label, description, enabled, effective, updatedAt, updatedBy }] }`.
- `PUT /internal/flags/:key { enabled, actor }` returns the same list after the write, or 409 `{ error }`. `actor` is
  the admin's email, stored as `updated_by`.

horo-admin checks `requireAdmin()` in its server action before calling (`src/app/(dashboard)/flags/actions.ts`), and
asks for confirmation before every toggle.

## Readers

`readFlags()` is called by the ดวงคู่ POST (teaser or full), history (`lockEnabled`), `checkUnlock` and
`chargeUnlockWithin` (free or paid), the wallet routes (enabled or not), and devtools regenerate.

## Local development

The internal routes need `ADMIN_API_SECRET` in `.env.local`. With the backend on :3011:

```bash
curl -X PUT localhost:3011/internal/flags/compat_lock -H "x-admin-secret: $ADMIN_API_SECRET" -H 'content-type: application/json' -d '{"enabled":true,"actor":"local"}'
```

Or directly in the local database:

```bash
docker exec local-postgres psql -U dev -d horo_dev -c "INSERT INTO feature_flags (key, enabled, updated_by) VALUES ('compat_lock', true, 'local') ON CONFLICT (key) DO UPDATE SET enabled = true"
```

Tests use `overrideFlags({...})` instead of the database. `tests/feature-flags.test.ts` checks the route's auth. With
`DATABASE_URL` and `WALLET_TEST_DATABASE_URL` both set to the local database, it also checks the parent, sub and
cascade rules. Those tests empty `feature_flags`, so reset your local flags afterwards.

## Production rollout

1. Deploy horo-be: `drizzle-kit push` creates `feature_flags` (additive). Every flag is off, which matches production
   before this change, where `COMPAT_LOCK_ENABLED` was never set.
2. Remove `COMPAT_LOCK_ENABLED` and `COMPAT_UNLOCK_FREE` from Railway if they exist; nothing reads them.
3. To launch paid ดวงคู่, turn `compat_lock` on in horo-admin.
