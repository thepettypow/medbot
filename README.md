# medbot — Medication reminder Telegram bot

Node (single process on a VPS) + grammY (long polling) + Neon Postgres. The bot talks Persian; all strings are in `src/i18n/fa.ts`.
Reminder only: no medical advice, no dose suggestions.

## Architecture

One long-running Node process on a VPS. The data stays in Neon Postgres.

- **Bot**: grammY long polling. No domain, TLS or webhook needed. On start it removes any old webhook.
- **Scheduler** (`src/scheduler.ts`): an in-process clock that ticks just after every minute boundary
  (`hh:mm:00.3`). Dose times are whole minutes, so a 12:00 dose goes out at ~12:00:00. It also runs once on
  boot to catch up anything still inside `DUE_WINDOW_MIN`. Ticks never overlap. Cleanup runs on boot and every 6 h.
- **Postgres** is the source of truth and the idempotency gate: a dose row is `UNIQUE (medication_time_id, scheduled_for)`
  and only the insert that wins sends, so a restart, a crash mid-tick or an accidental second instance can never double-send.
- Doses older than `STALE_AFTER_MIN` (e.g. the process was down) are **never sent late**: they become `missed_system` and the admin is told.
- Every dose status change is written to `dose_status_log` by a DB trigger (audit trail).
- Every dose button update is `UPDATE … WHERE status='sent'`, so concurrent taps cannot double-apply.
- Optional `GET /health` on `127.0.0.1:$HEALTH_PORT` → `{ok, db, tickAgeSec}` (503 if the DB is down or no tick in 3 min).
- Logs go to stdout (`journalctl -u medbot -f`): one `tick` line per minute with sent/failed counts and `lateMs`.
  Message text, names and medications are never logged.

## Setup (VPS, Ubuntu/Debian)

1. **Node 22.9+** (`node -v`) and a synced clock: `timedatectl` should say `System clock synchronized: yes`
   (accuracy is only as good as the server clock).
2. **Telegram**: create a bot with @BotFather. Get your numeric ID from @userinfobot.
3. **Code**:
   ```
   sudo useradd --system --home /opt/medbot --shell /usr/sbin/nologin medbot
   sudo git clone <repo-url> /opt/medbot && cd /opt/medbot
   sudo npm ci --omit=dev
   sudo cp .env.example .env && sudo nano .env      # BOT_TOKEN, ADMIN_CHAT_IDS, DATABASE_URL
   sudo chown -R medbot:medbot /opt/medbot && sudo chmod 600 .env
   ```
4. **Schema**: `npm run migrate` (idempotent, safe to re-run).
5. **Service**:
   ```
   sudo cp deploy/medbot.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now medbot
   journalctl -u medbot -f        # expect "bot started" and a "tick" line every minute
   ```
6. Smoke test: message your bot `/admin`, then `/status` (last scheduler run should be 0–1 min ago).

**Update**: `cd /opt/medbot && sudo git pull && sudo npm ci --omit=dev && npm run migrate && sudo systemctl restart medbot`.
A restart is safe: doses due during the gap (up to `DUE_WINDOW_MIN`) are sent on boot.

Run **one** instance per bot token. Telegram allows only one long-polling consumer; a second one gets 409 errors.
The reminders themselves would still never double-send.

Local dev: `cp .env.example .env`, fill it in, `npm run dev`.

### Config (all optional)

| Var | Default | |
|---|---|---|
| `DEFAULT_TIMEZONE` | `Asia/Tehran` | offered as the quick-tap default. Must be a valid IANA id (`Asia/Tehran`, **not** `Iran/Tehran`) |
| `DUE_WINDOW_MIN` / `STALE_AFTER_MIN` | 10 / 10 | send window after a restart; older than this ⇒ `missed_system` |
| `HEALTH_PORT` / `HEALTH_HOST` | 0 (off) / `127.0.0.1` | local health endpoint |
| `MISSED_AFTER_MIN` | 120 | no answer ⇒ `missed` |
| `NUDGE_OFFSETS_MIN` | `15,45` | re-nudge schedule; empty disables |
| `SNOOZE_MIN` / `MAX_SNOOZES` | 30 / 2 | |

## Tests

```
npm test                                   # unit tests (time parsing, DST)
TEST_DATABASE_URL=postgres://... npm test  # + engine and end-to-end bot tests on a scratch Postgres
```
The DB tests `TRUNCATE` the tables, so point them at a throwaway database. They cover idempotency under 5 concurrent ticks,
stale doses, grouping, retries, nudges, snooze limits, block handling, consent/invite rules, hard delete and the scheduler's minute alignment.

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
