-- schema.sql
-- The bot runs this file on every startup, so every statement must be idempotent.
-- You can also apply it by hand: psql -d injekta_db -f schema.sql

-- Injection logs, kept separately per server (guild_id)
CREATE TABLE IF NOT EXISTS injections (
    id SERIAL PRIMARY KEY,
    guild_id VARCHAR(32),                       -- Discord server the log belongs to
    user_id VARCHAR(255) NOT NULL,              -- Discord User ID
    leg VARCHAR(10) NOT NULL CHECK (leg IN ('Right', 'Left')),
    injection_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    performed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, -- When the injection actually happened
    medication VARCHAR(100),
    dose_mg NUMERIC(10,2),
    raw_units INT,
    created_by_admin_id VARCHAR(255),           -- Admin who logged on behalf of a user
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Columns added after the first release
ALTER TABLE injections ADD COLUMN IF NOT EXISTS guild_id VARCHAR(32);
ALTER TABLE injections ADD COLUMN IF NOT EXISTS performed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE injections ADD COLUMN IF NOT EXISTS medication VARCHAR(100);
ALTER TABLE injections ADD COLUMN IF NOT EXISTS dose_mg NUMERIC(10,2);
ALTER TABLE injections ADD COLUMN IF NOT EXISTS raw_units INT;
ALTER TABLE injections ADD COLUMN IF NOT EXISTS created_by_admin_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_injections_guild_user ON injections(guild_id, user_id, performed_at DESC);

-- Per-server settings: reminder channel and hormone test reminders
CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id VARCHAR(32) PRIMARY KEY,
    channel_id VARCHAR(32),                     -- Channel for /injection and channel reminders
    test_start_time TIMESTAMPTZ,
    test_interval_days NUMERIC(6,2),
    test_timezone VARCHAR(100),
    test_last_run_at TIMESTAMPTZ
);

-- A user's schedule in a server. Reminders only go to people who set one.
CREATE TABLE IF NOT EXISTS user_schedules (
    guild_id VARCHAR(32) NOT NULL,
    user_id VARCHAR(32) NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    interval_days NUMERIC(6,2) NOT NULL,
    timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
    medication VARCHAR(100),
    dose_mg NUMERIC(10,2),
    last_run_at TIMESTAMPTZ,
    PRIMARY KEY (guild_id, user_id)
);

-- Privacy choices per user per server. No row means the private defaults.
CREATE TABLE IF NOT EXISTS user_settings (
    guild_id VARCHAR(32) NOT NULL,
    user_id VARCHAR(32) NOT NULL,
    share_with_admins BOOLEAN NOT NULL DEFAULT FALSE,
    remind_via VARCHAR(10) NOT NULL DEFAULT 'dm' CHECK (remind_via IN ('dm', 'channel')),
    PRIMARY KEY (guild_id, user_id)
);

-- Admin action audit log
CREATE TABLE IF NOT EXISTS admin_actions (
    id SERIAL PRIMARY KEY,
    guild_id VARCHAR(32),
    admin_user_id VARCHAR(255) NOT NULL,
    target_user_id VARCHAR(255),
    action VARCHAR(50) NOT NULL,
    log_id INT,
    details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE admin_actions ADD COLUMN IF NOT EXISTS guild_id VARCHAR(32);

CREATE INDEX IF NOT EXISTS idx_admin_actions_admin ON admin_actions(admin_user_id);

COMMENT ON TABLE injections IS 'Injection logs per user per server (last 5 kept).';
COMMENT ON TABLE guild_settings IS 'Per-server reminder channel and hormone test reminders.';
COMMENT ON TABLE user_schedules IS 'Personal injection schedules.';
COMMENT ON TABLE user_settings IS 'Per-user privacy choices. Defaults are private.';
