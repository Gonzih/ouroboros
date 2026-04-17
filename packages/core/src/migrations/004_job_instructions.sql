-- Store worker instructions on the job row so retry and inspection tools
-- can access the original instructions (which may differ from description).
ALTER TABLE ouro_jobs ADD COLUMN IF NOT EXISTS instructions TEXT;
