-- Add process tracking fields to jobs
ALTER TABLE ouro_jobs ADD COLUMN IF NOT EXISTS pid INTEGER;
ALTER TABLE ouro_jobs ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE ouro_jobs ADD COLUMN IF NOT EXISTS last_heartbeat TIMESTAMPTZ;

-- Service process registry: tracks long-running services (gateway, ui, workers)
CREATE TABLE IF NOT EXISTS ouro_processes (
  name           TEXT PRIMARY KEY,       -- 'gateway', 'ui', 'worker:{jobId}'
  pid            INTEGER NOT NULL,
  command        TEXT NOT NULL,
  args           TEXT[] NOT NULL DEFAULT '{}',
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
