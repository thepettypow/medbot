# medbot — Medication reminder Telegram bot

Next.js (Vercel) + grammY (webhook) + Neon Postgres. The bot talks Persian; all strings are in `src/i18n/fa.ts`.
Reminder only: no medical advice, no dose suggestions.

## Setup

1. **Neon**: create a project in an EU region (e.g. Frankfurt), copy the pooled connection string.
2. **Telegram**: create a bot with @BotFather, copy the token.
3. **Env vars** (see `.env.example`): `BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (random), `CRON_SECRET` (random),
   `DATABASE_URL`, `ADMIN_CHAT_IDS` (comma-separated numeric Telegram IDs; get yours from @userinfobot).
   Set them in Vercel (Project → Settings → Environment Variables, region **fra1**) and locally for the scripts below.
4. **Schema**: `DATABASE_URL=... npm run migrate` (idempotent, safe to re-run).
5. **Deploy** to Vercel, then register the webhook:
   ```
   BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... npm run set-webhook -- https://<your-app>.vercel.app
   ```
   This sets `secret_token` and `allowed_updates = message, callback_query, my_chat_member`.
6. **Scheduler** (pick one; the logic is identical, idempotency makes overlapping pings safe):
   - **Vercel Pro**: `cp vercel.pro.json vercel.json` (remind every minute, cleanup every 6 h). Vercel sends
     `Authorization: Bearer $CRON_SECRET` automatically. *A per-minute cron in `vercel.json` makes Hobby deploys fail, which is why it is not the default.*
   - **Hobby / anything else**: `.github/workflows/cron.yml` pings every 5 min (add repo secrets `APP_URL`, `CRON_SECRET`),
     or use cron-job.org with the header `Authorization: Bearer <CRON_SECRET>` on `GET /api/cron/remind` (1–5 min)
     and `GET /api/cron/cleanup` (every few hours). GitHub's schedule is best-effort, so with a 5-min pinger set
     `DUE_WINDOW_MIN=10` and `STALE_AFTER_MIN=10` to survive jitter. The "<60 s" goal needs a 1-min scheduler.
7. Smoke test: open `/api/health` → `{"ok":true}`; message your bot `/admin`; check `/status`.

## How it works

- `POST /api/telegram` — webhook (secret-token verified by grammY).
- `GET /api/cron/remind` — computes due doses in each person's timezone (luxon; DST-safe), inserts a `dose_events` row
  guarded by `UNIQUE (medication_time_id, scheduled_for)` (**only the insert that wins sends**), groups same-time meds into one message,
  retries failed sends (atomic claim, max 3), re-sends finished snoozes, sends re-nudges, marks unanswered doses `missed`.
  Doses older than `STALE_AFTER_MIN` are **never sent** — they become `missed_system` and the admin is told.
- `GET /api/cron/cleanup` — purges old invites/flow state, marks stragglers, alerts admins if the reminder cron went quiet.
- `GET /api/health` — DB check.
- Every dose status change is written to `dose_status_log` by a DB trigger (audit trail).
- Every dose button update is `UPDATE … WHERE status='sent'`, so concurrent taps cannot double-apply.

### Config (all optional)

| Var | Default | |
|---|---|---|
| `DEFAULT_TIMEZONE` | `Asia/Tehran` | offered as the quick-tap default. Must be a valid IANA id (`Asia/Tehran`, **not** `Iran/Tehran`) |
| `DUE_WINDOW_MIN` / `STALE_AFTER_MIN` | 10 / 10 | send window; older than this ⇒ `missed_system` |
| `MISSED_AFTER_MIN` | 120 | no answer ⇒ `missed` |
| `NUDGE_OFFSETS_MIN` | `15,45` | re-nudge schedule; empty disables |
| `SNOOZE_MIN` / `MAX_SNOOZES` | 30 / 2 | |

## Tests

```
npm test                                   # unit tests (time parsing, DST)
TEST_DATABASE_URL=postgres://... npm test  # + engine and end-to-end bot tests on a scratch Postgres
```
The DB tests `TRUNCATE` the tables, so point them at a throwaway database. They cover idempotency under 5 concurrent crons,
stale doses, grouping, retries, nudges, snooze limits, block handling, consent/invite rules, hard delete and route auth.

## Behaviour notes / deliberate choices

- Weekdays are stored `0=Sunday … 6=Saturday` and shown Saturday-first.
- Editing a medication's times soft-removes old times, so dose history is kept; deleting a medication deletes its history (confirmed).
- A time slot never fires for instants before the slot was created or before the person was started (no backfill).
- Dates are typed Gregorian (`2026-10-20`); Persian digits are accepted everywhere.
- Patient self-pause (`/settings`) and a basic `/report` (today/7/30 days, adherence %, per-medication) are included early.
- Not built yet (P1/P2): admin escalation after consecutive misses, weekly summary, streaks, stock tracking, travel mode,
  advanced schedules, named multi-admin, CSV export, Jalali dates.

## Before launch

Run it a full week with 2–3 trusted people (PRD §16). Health data is GDPR Art. 9: if this serves anyone beyond family/friends, get legal advice.
