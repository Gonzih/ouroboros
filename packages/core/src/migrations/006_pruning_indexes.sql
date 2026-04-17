-- Index to accelerate the watchdog's pruning subquery:
--   SELECT id FROM ouro_jobs WHERE status IN ('completed','failed','cancelled')
--     AND completed_at < NOW() - INTERVAL '7 days'
-- Without this, each watchdog tick does a full seq scan of ouro_jobs.
CREATE INDEX IF NOT EXISTS idx_ouro_jobs_status_completed_at
  ON ouro_jobs(status, completed_at)
  WHERE completed_at IS NOT NULL;
