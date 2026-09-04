---
type: REFERENCE
status: active
scope: compatibility-v2
last_reviewed: 2026-09-04
owner: backend
supersedes: []
superseded_by: null
---

# Compatibility scoring v2

`lib/astrology/compatibility.ts` owns the deterministic 0–100 score. The LLM writes only the relationship narrative and cannot alter the score.

## Formula

`score = round(elementHarmony × 0.55 + branchHarmony × 0.45)`

- Element harmony compares the two day-master elements through the existing Five Element producing and controlling cycles.
- Branch harmony compares day branches at 70% and year branches at 30%.
- Branch relationships, from strongest to most difficult, are: six combination, trine group, same, neutral, six harm, and six clash.
- Producing and controlling weights are symmetric: swapping person A and B cannot change the score.

The current score bands are:

| Score | User-facing interpretation |
|---|---|
| 80–100 | compatibility is notably supportive |
| 65–79 | generally compatible with adjustment areas |
| 50–64 | mixed; communication and pacing matter |
| 0–49 | clear friction; boundaries need care |

## Guarantees and limits

- Identical inputs are deterministic.
- Scores and sub-scores remain within 0–100.
- Ordinary fixture dates produce a non-constant distribution.
- This is a transparent entertainment heuristic based on the product's astrology model, not a scientific prediction of relationship outcomes.
- Existing database rows retain the historical placeholder score. API readers mark them as `contentVersion: 1`, while newly calculated results are `contentVersion: 2`; never infer the score version from `score === 75`, because v2 can legitimately produce 75.

## Verification

Run `bun test tests/compatibility.test.ts`. The focused suite checks determinism, symmetry, bounds, supportive-versus-tense ordering, and score spread. The route persists `calculateCompatibility()` output directly in `src/systems/compatibility/routes.ts`.

## Narrative payload

New readings store a compact JSON object in the existing `analysis` text column and expose its parsed form as `structuredContent`. This avoids a schema migration for the content rollout while preserving old markdown rows.

- `scoreExplanation` is deterministic and cannot be changed by the LLM.
- `verdict` is one shareable sentence.
- `chemistry`, `caution`, and `advice` are each capped at 500 characters and prompted to remain within three sentences.
- API responses use `contentVersion: 2` with parsed content, or `contentVersion: 1` and `structuredContent: null` for legacy markdown.
- Deployment order is tolerant frontend reader first, then backend writer. A separate score-version database column is not required for this rollout because the validated content version distinguishes old and new rows at the API boundary.

Run `bun test tests/compatibility-content.test.ts` for schema, legacy parsing, and prompt-contract coverage.
