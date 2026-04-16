-- Runs inside the Postgres container on first startup
-- Installs pgmq extension so it's available for all packages

CREATE EXTENSION IF NOT EXISTS pgmq;
