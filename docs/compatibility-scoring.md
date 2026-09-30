---
type: REFERENCE
status: active
scope: compatibility-v2 score, report v4 dimensions, archetype, calendar and how they are worded for the model
last_reviewed: 2026-09-30
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
- Rows written before this formula kept the historical placeholder score. They are legacy rows (`content_version` NULL) and are no longer served (`docs/compatibility-response-fix.md`, "Canon v1"); never infer the score version from `score === 75`, because v2 can legitimately produce 75.

## Verification

Run `bun test tests/compatibility.test.ts`. The focused suite checks determinism, symmetry, bounds, supportive-versus-tense ordering, and score spread. The route persists `calculateCompatibility()` output directly in `src/systems/compatibility/routes.ts`.

## Narrative payload

The v2 narrative payload (`scoreExplanation`, `verdict`, `chemistry`, `caution`, `advice`) was retired on 2026-09-30,
with its schema, parser and tests. The only report is canon v1 (`contentVersion: 4`), described in
`docs/compatibility-response-fix.md`.

## Report v4: dimensions, archetype, calendar

`lib/astrology/compatibility-report.ts` computes these for the v4 report; `bun test tests/compatibility-report.test.ts` covers them. The LLM explains them and never changes them. The overall score above is unchanged; v4 drops its 4-band canned `overallAnalysis` text (the overview and dimension lines replace it).

### Inputs (`pairInputs`)

| Input | From | Values |
|---|---|---|
| element class | the two day-master elements | same, generating (either produces the other), controlling (either controls the other) |
| day-branch relation | day branches: the spouse palace, นักษัตรวันเกิด | combine, trine, same, neutral, harm, clash |
| year-branch relation | year branches (ปีนักษัตร; a clash is ปีชง) | same six |
| stem combine | day masters form a 天干五合 pair (jia-ji, yi-geng, bing-xin, ding-ren, wu-gui) | yes / no |
| MBTI | both people's codes; one side alone is treated as none | letters compared per axis |

Every input is symmetric, so swapping the two people never changes a score, the archetype or a month label.

### Dimensions (4, not 5)

Each is a weighted sum of per-input tables, bounded to 5–97 (a heuristic never claims 0 or 100).

| Dimension | With both MBTI | Without | Why these inputs |
|---|---|---|---|
| เคมี (chemistry) | 0.55 day branch + 0.45 element + 12 if stem combine | same | The spouse palace and stem combination are the classical attraction markers. A clash keeps chemistry mid (58): strong pull, with friction. |
| การสื่อสาร | 0.45 MBTI (S/N and T/F match) + 0.35 element + 0.2 day branch | 0.6 element + 0.4 day branch | Shared perception and decision style is how two people hear each other. A generating element pair "flows"; a harm (害) is the misreading relation. |
| ความไว้ใจ | 0.5 day branch + 0.3 year branch + 0.2 element | same | The spouse palace carries the bond; the zodiac year carries family and social fit; a controlling element pair is a power imbalance. |
| จังหวะชีวิต | 0.5 year branch + 0.5 MBTI (E/I and J/P match) | 0.7 year branch + 0.3 element | Zodiac-year fit and social energy plus planning style set daily pace. |

The per-relation tables are in the code next to each formula. The chosen weights leave these spreads over 2,000 random birth-date pairs: standard deviation 10–12 per dimension, 23–37% of pairs in the 50–60 band, and no pair with four equal bars.

There is no fifth "อนาคต" bar. Nothing the engine computes speaks to a relationship's future beyond what the four dimensions already use, so a fifth bar would be a re-weighted average dressed as a prediction. The 3-month calendar covers time instead.

### Archetype

`lib/astrology/compatibility-archetypes.ts` has 15 names, one per unordered pair of day-master elements, each a poetic element image with a one-line tagline (e.g. fire and metal is คู่ไฟหลอมทอง). It is a draft for owner review. The rules for the names:
- only the pair's own elements, since an image must be true for the pair;
- no doom names;
- nothing that friend-zones a love pair or only fits a couple.

The first draft keyed on element class × spouse palace (18 names). Element imagery can't be keyed that way: "generating" covers five different element pairs, so an element word in its name would be wrong for four of them. The spouse palace still sets the chemistry score and leads the verdict when it isn't neutral.

### Calendar

- **Months covered:** the three Gregorian months after the current Bangkok month.
- **Pillar used:** each month uses the Bazi month pillar in force on its 15th, from `calculateBazi`. Bazi months start around the 4th to 8th, so the 15th falls well inside.
- **Points per person:** the pillar's **stem element** is compared with each day master, and its branch with each day branch. Points are summed over both people:
  - element: resource +2, companion +1, output +1, wealth 0, pressure −2;
  - branch: combine +2, trine +1, same 0, neutral 0, harm −1, clash −2.
- **Label:** a total of 3 or more is ดี (`good`), −1 or less is ระวัง (`caution`), otherwise กลาง (`mixed`). A month whose branch clashes either spouse palace is never ดี.
- **Distribution:** across random pairs the labels land about 27% / 46% / 27%.
- **The recommended month** for the future chapter's next step is the first ดี month. With none it is the first กลาง month, and otherwise the first month.

### How the facts are worded for the model

`buildCompatibilityPromptV4` in `src/lib/prompts.ts` turns the facts into Thai. Two wording rules matter for what the buyer reads first:
- **A neutral relation is open, not empty.** Half of all pairs have a neutral spouse palace (6 of 12 branches). The prompt used to call it "no special force", and 6 of 10 sample verdicts then said the chart had nothing to say. The prompt now describes it as an open palace that doesn't force the relationship either way.
- **The report leads with the strongest signal.** The spouse palace comes first when it is not neutral. Otherwise the element relation leads, with a fixed image per element pair (`ELEMENT_IMAGE`, e.g. fire controlling metal is ไฟหลอมทอง), then the year branch, then the MBTI pairing. The 15 images are a draft for owner review; every pair with the same two elements gets the same image.

Dimension scores reach the model as a level (เด่น, ดี, กลาง, ต้องใส่ใจ) without the number, since the bar already shows it.

`generateCompatibilityV4` checks the result (`tests/compatibility-v4.test.ts`):
- **Fail the reading if the repair turns don't fix them:**
  - a claim that the chart is silent in the verdict, the overview or the attraction chapter (`chartSilence`);
  - a digit in a dimension line.
- **Get one repair, then a quality flag:** a verdict that doesn't name the partner, has no concrete from the pair's chart (one of their elements, or a non-neutral palace or year relation), or uses a known cliché or over-claim. Quality issues get only the first repair turn of a call. If that repair breaks a rule and the repairs run out, the reply before it is kept with its flags, so a quality repair never costs a valid reading.
- **Corrected without a repair:** the known misspellings in `fixKnownTypos` (กระทันหัน, เลาไว้ and others seen in the samples).
