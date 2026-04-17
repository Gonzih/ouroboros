-- Store pgmq message ID so approval pollers can be resumed after meta-agent restart
ALTER TABLE ouro_feedback ADD COLUMN IF NOT EXISTS queue_msg_id BIGINT;
