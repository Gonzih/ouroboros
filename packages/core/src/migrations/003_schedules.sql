-- Scheduled jobs: recurring task templates that the scheduler loop dispatches
CREATE TABLE IF NOT EXISTS ouro_schedules (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT        NOT NULL UNIQUE,
  cron_expr    TEXT        NOT NULL,
  backend      TEXT        NOT NULL,
  target       TEXT        NOT NULL,
  instructions TEXT        NOT NULL,
  enabled      BOOLEAN     NOT NULL DEFAULT TRUE,
  last_run_at  TIMESTAMPTZ,
  next_run_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
