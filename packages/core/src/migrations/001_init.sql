-- Enable pgmq for queues
CREATE EXTENSION IF NOT EXISTS pgmq;

-- Queues (created once, idempotent)
DO $$
BEGIN
  PERFORM pgmq.create('ouro_tasks');
  PERFORM pgmq.create('ouro_feedback');
END
$$;

-- Job state
CREATE TABLE IF NOT EXISTS ouro_jobs (
  id           TEXT PRIMARY KEY,
  description  TEXT NOT NULL,
  backend      TEXT NOT NULL,
  target       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error        TEXT,
  output       TEXT
);

CREATE TABLE IF NOT EXISTS ouro_job_output (
  job_id TEXT NOT NULL REFERENCES ouro_jobs(id),
  line   TEXT NOT NULL,
  ts     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_job_output_job_id ON ouro_job_output(job_id);

-- MCP registry
CREATE TABLE IF NOT EXISTS ouro_mcp_registry (
  name              TEXT PRIMARY KEY,
  connection_string TEXT NOT NULL,
  server_config     JSONB NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  validation_log    TEXT,
  tools_found       TEXT[],
  registered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  validated_at      TIMESTAMPTZ
);

-- Feedback / evolution history
CREATE TABLE IF NOT EXISTS ouro_feedback (
  id               TEXT PRIMARY KEY,
  source           TEXT NOT NULL,
  text             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',
  pr_url           TEXT,
  pr_diff          TEXT,
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ
);

-- Logs (unpartitioned in v1 for simplicity)
CREATE TABLE IF NOT EXISTS ouro_logs (
  id      BIGSERIAL PRIMARY KEY,
  source  TEXT NOT NULL,
  message TEXT NOT NULL,
  ts      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ouro_logs_ts ON ouro_logs(ts);
