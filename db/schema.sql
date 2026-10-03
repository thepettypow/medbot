-- Idempotent schema. Run with: npm run migrate
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  telegram_chat_id bigint UNIQUE,
  timezone text NOT NULL DEFAULT 'Asia/Tehran',
  status text NOT NULL DEFAULT 'pending_link'
    CHECK (status IN ('pending_link','connected','active','paused','blocked')),
  resume_status text,                 -- status to restore after block / self-pause
  active_since timestamptz,           -- reminders never backfill before this
  consent_at timestamptz,
  consent_version text,
  created_by_admin_chat_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invites (
  id bigserial PRIMARY KEY,
  person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,    -- sha256 hex; the token itself is never stored
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invites_person_idx ON invites(person_id);

CREATE TABLE IF NOT EXISTS medications (
  id bigserial PRIMARY KEY,
  person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  name text NOT NULL,
  dose text NOT NULL,
  note text,
  days_of_week smallint[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}', -- 0=Sunday .. 6=Saturday
  start_date date NOT NULL,
  end_date date,
  is_active boolean NOT NULL DEFAULT true,
  stock_count integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS medications_person_idx ON medications(person_id);

CREATE TABLE IF NOT EXISTS medication_times (
  id bigserial PRIMARY KEY,
  medication_id bigint NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  local_time time NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), -- doses before this are never backfilled
  removed_at timestamptz,                        -- soft-remove on edit so dose history survives
  UNIQUE (medication_id, local_time)
);

CREATE TABLE IF NOT EXISTS dose_events (
  id bigserial PRIMARY KEY,
  medication_time_id bigint NOT NULL REFERENCES medication_times(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','taken','snoozed','skipped','missed',
                      'send_failed','missed_system','cancelled')),
  sent_at timestamptz,
  responded_at timestamptz,
  nudge_count smallint NOT NULL DEFAULT 0,
  snooze_count smallint NOT NULL DEFAULT 0,
  snooze_until timestamptz,
  send_attempts smallint NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  telegram_message_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (medication_time_id, scheduled_for)   -- the heart of idempotency
);
CREATE INDEX IF NOT EXISTS dose_person_sched_idx ON dose_events(person_id, scheduled_for);
CREATE INDEX IF NOT EXISTS dose_status_sched_idx ON dose_events(status, scheduled_for);
CREATE INDEX IF NOT EXISTS dose_msg_idx ON dose_events(person_id, telegram_message_id);

-- Audit trail: every status change is timestamped (trigger => cannot be forgotten in code).
CREATE TABLE IF NOT EXISTS dose_status_log (
  id bigserial PRIMARY KEY,
  dose_event_id bigint NOT NULL REFERENCES dose_events(id) ON DELETE CASCADE,
  status text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION log_dose_status() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO dose_status_log(dose_event_id, status) VALUES (NEW.id, NEW.status);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS dose_status_audit ON dose_events;
CREATE TRIGGER dose_status_audit AFTER INSERT OR UPDATE OF status ON dose_events
  FOR EACH ROW EXECUTE FUNCTION log_dose_status();

CREATE TABLE IF NOT EXISTS admin_state (
  chat_id bigint PRIMARY KEY,
  flow text NOT NULL,
  step text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Small key/value store: last cron run, alert throttles.
CREATE TABLE IF NOT EXISTS kv (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
