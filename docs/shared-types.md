# Shared Types

`horo-be/lib/shared/types/` is the source of truth for types shared between the
backend (horo-be) and frontend (horo-fe). The frontend copies at
`horo-fe/src/lib-packages/shared/types/` are generated — do not edit them by hand.

## Syncing

After changing a file in `lib/shared/types/`, run:

```bash
bun run sync:types
```

This copies every file in `lib/shared/types/` to
`../horo-fe/src/lib-packages/shared/types/`, prepending a generated-file header.

## Checking (CI)

To verify the FE copies are in sync without writing anything:

```bash
bun run sync:types --check
```

Exits non-zero and prints which files are out of sync if the FE copies don't
match. Use this in CI to catch a forgotten sync before it merges.
