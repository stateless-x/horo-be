# Campaign email

Sends a one-off message to users, capped per day, never twice to the same person.

## Setup (one time)

1. **Verify a sending domain in Resend** — [resend.com/domains](https://resend.com/domains).
   Resend only sends for domains you prove you control via DNS, so a personal
   mailbox like `askpurin@pm.me` can *never* be the From address. Put it in
   `EMAIL_REPLY_TO` instead; replies then land there normally.
2. **Set env vars** (see `.env.example`): `RESEND_API_KEY`, `EMAIL_FROM`,
   `EMAIL_REPLY_TO`, `EMAIL_DAILY_CAP`.
3. **Push the schema**: `bun run db:push` — adds `email_sends` and
   `user.emailOptOut`. Both additive, so push applies them without prompting.

## Writing a campaign

Drop a markdown file in `content/campaigns/`:

```markdown
---
name: Relaunch — ชวนกลับมาลอง       # optional label, for your own recall
subject: หัวเรื่องของอีเมล
---
สวัสดี {{name}}

เนื้อหา **ตัวหนา** และ [ลิงก์](https://example.com)
```

The filename minus `.md` is the campaign id. **Treat it as immutable once a send
starts** — renaming orphans the progress and re-sends to everyone.

`name` is optional and purely cosmetic — it shows in `--status` and the campaign
listing so you can tell `2026-09-15-relaunch` from `2026-10-01-relaunch-v2` at a
glance. It is not stored per row and not part of the dedupe key, so you can
reword it any time without affecting who has been sent what.

`{{name}}` becomes the user's display name, falling back to their account name,
then `คุณ`.

### Thai domains in links

Write the label in Thai and the href in punycode:

```markdown
[สายมู.com/login](https://xn--y3cbx6azb.com/login)
```

Readers see Thai; mail servers and spam filters see plain ASCII. Thai-script
hrefs are unreliable — some clients don't linkify them and some filters find
them suspicious.

## Sending

```bash
# 1. See what would go out — writes nothing, sends nothing
bun run scripts/send-campaign.ts --campaign 2026-09-15-relaunch --dry-run

# 2. Live test to yourself first.
#    NOTE: --only filters the `user` table, so it must be an address that has an
#    account. A personal mailbox you never signed up with matches nothing and
#    prints "Nothing to send" — replies reach it via EMAIL_REPLY_TO instead.
bun run scripts/send-campaign.ts --campaign 2026-09-15-relaunch --only you@example.com --confirm 1

# 3. Send a real batch (the count must match what step 1 printed)
bun run scripts/send-campaign.ts --campaign 2026-09-15-relaunch --confirm 100

# Progress across all campaigns
bun run scripts/send-campaign.ts --status
```

### Manual approval

**A send never happens from `--campaign` alone.** Without `--confirm <n>` the
script prints the batch and exits. The number must equal the recipient count it
showed; if the eligible set changed since you looked (a new signup, an opt-out),
the run aborts rather than mailing a set you didn't review.

This is also why an unattended cron cannot send: it has no way to supply a
number a human never saw. Scheduling is deliberately manual.

## How "never twice" works

`email_sends` has `UNIQUE(user_id, campaign_id)`. Each recipient is **claimed by
inserting a `pending` row before the API call**, using
`onConflictDoNothing().returning()` — so only rows this run actually claimed get
sent. A re-run, a concurrent run, or a double-fired cron all lose the conflict
and send nothing.

The claim happening *before* the send is the whole design. A `lastEmailedAt`
column written *after* a successful send would re-send to everyone the process
crashed on.

### Failure handling

| Outcome | Row | Next run |
|---|---|---|
| Sent | `sent` + provider id | skipped |
| Transient failure (network, 5xx, 429) | row deleted | **retried automatically** |
| Permanent failure (bad address, 403) | `failed` + error | never retried |
| Crash mid-send | stranded `pending` | not retried; `--requeue` to release |
| DB error on one recipient | may strand `pending` | batch continues; `--requeue` to release |

Transient failures are safe to retry because Resend never accepted the message.
Permanent ones are not retried on purpose: repeatedly mailing dead addresses is
what damages sending reputation.

A crash strands a row as `pending` — that user is skipped rather than
double-sent. That's the deliberate tradeoff: **a crash may silently skip
someone, but can never double-send.** `--requeue` releases stranded rows, and
prints how many it found so a systematic failure is visible rather than silently
retried.

### Turning unsubscribe off

`--no-unsubscribe` omits the footer link and the headers. Doing so means an
unhappy recipient's only route is "Report spam", which is the single most
damaging signal to a sending domain — so it is an explicit flag, never a
default.

## Unsubscribe

Every campaign email carries a footer link and the `List-Unsubscribe` /
`List-Unsubscribe-Post` headers that make Gmail and Outlook show a native
unsubscribe control. That control is what keeps an annoyed recipient from
reaching for "Report spam" — the single most damaging signal to a sending
domain.

`GET|POST /email/unsubscribe/:token` sets `user.emailOptOut`, which recipient
selection excludes. The route is intentionally unauthenticated — opting out
shouldn't require a login — and the token is `<userId>.<hmac>`, so nobody can
opt out someone else by editing the URL.

Opt-out applies to campaigns only; transactional mail (login, password reset)
ignores it.

## Resending a revised message

Campaign ids are versioned by filename, so an updated message is a **new
campaign**, not an edit of the old one:

```
content/campaigns/2026-09-15-relaunch.md      # v1, already sent to 400 users
content/campaigns/2026-10-01-relaunch-v2.md   # revised — everyone is eligible again
```

Never edit a file that has already been sent. The id is the dedupe key, so
editing in place means the people who got v1 are marked done and will never
receive the revision, while the row history still claims they got the new text.

Every row carries two timestamps, so history stays queryable per version:

- `created_at` — when the recipient was claimed
- `sent_at` — when Resend accepted it (NULL for pending/failed rows)

```sql
-- who got which version, and when
select campaign_id, status, count(*), min(sent_at), max(sent_at)
from email_sends group by campaign_id, status order by campaign_id;
```

To re-send the *same* text to everyone (rare — usually a mistake), copy the file
to a new id. To re-send to one person, delete their row for that campaign and
they become a candidate again.

## Capacity

At `EMAIL_DAILY_CAP=100` (Resend free tier), ~2,000 users takes ~20 days per
campaign. The cap counts sends across *all* campaigns, since the provider quota
is per account — so a second run the same day tops up to the cap rather than
doubling it.

**The quota is shared with every other site on the same Resend account**, and
this script only counts its own sends — other senders are invisible to it. Set
`EMAIL_DAILY_RESERVE` to roughly what those other sites use per day, or a
campaign can consume the whole allowance and their mail starts failing. With
`EMAIL_DAILY_CAP=100` and `EMAIL_DAILY_RESERVE=20`, campaigns use at most 80/day.

If you start a second campaign before the first drains, they compete for the
same 100/day. Drain one before starting the next; `--status` shows where each
stands.
