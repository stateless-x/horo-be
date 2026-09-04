# Architecture

## `src/systems/`

Each fortune-telling product lives in its own folder under `src/systems/`:

```
src/systems/
  shared.ts               # helpers genuinely used by 2+ systems (currently: getCachedProfile)
  index.ts                 # mounts every system's routes; exports systemsRoutes
  fusion/
    routes.ts              # Bazi x Thai x MBTI: teaser, chart, daily, profile, user-profile, update-profile
  compatibility/
    routes.ts              # compatibility create/history/get/share
```

`src/index.ts` mounts `systemsRoutes` (from `src/systems/index.ts`) instead of
importing route files directly.

### Adding a new fortune-telling system

1. Create `src/systems/<name>/routes.ts` exporting an `Elysia` instance with
   `prefix: '/api/fortune'` (see URL path conventions below).
2. Add it to the `.use(...)` chain in `src/systems/index.ts`.
3. If a helper is used by 2+ systems, move it to `src/systems/shared.ts`.
   Otherwise keep helpers local to the system's own `routes.ts`.
4. Don't touch `lib/gemini.ts`, `lib/rate-limit.ts`, `lib/astrology/**`, or
   auth — those are shared infrastructure, not system-specific.

### URL path conventions

All fortune endpoints live under `/api/fortune/...`, regardless of which
system folder they're implemented in. The route path is what's byte-stable
for the frontend; the folder structure is purely a backend organization
concern and must never change a path.

### Prompts

`src/lib/prompts.ts` holds prompt builders shared or ambiguous across
systems (`buildMbtiContext`, `SYSTEM_PROMPT`, `SYSTEM_PROMPT_STRUCTURED`,
`buildCompatibilityPrompt`, `buildTeaserPrompt`, `buildStructuredChartPrompt`).
It was NOT split into per-system files: `buildMbtiContext` is consumed by
both `src/lib/prompts/today.ts` (fusion's daily prompt) and
`buildCompatibilityPrompt` (compatibility), and `SYSTEM_PROMPT` is consumed
by `lib/gemini.ts`, which sits outside `systems/` entirely. Splitting would
have meant either duplicating `buildMbtiContext` or introducing a
cross-directory import just to satisfy a folder boundary — not worth it for
a 636-line file with one genuinely shared helper.

`src/lib/prompts/today.ts` (fusion's actual daily-reading prompt,
`buildTodayPrompt`) already lives outside `fortune.ts`/`systems/` and was
left in place.

### Shared types

See [`shared-types.md`](./shared-types.md) for how types are shared between
`horo-be` and `horo-fe`.
