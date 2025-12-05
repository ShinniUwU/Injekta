-- schema.sql
-- Run this script against your PostgreSQL database to create the necessary tables.

-- Create the injections table
CREATE TABLE IF NOT EXISTS injections (
    id SERIAL PRIMARY KEY,                      -- Auto-incrementing integer ID
    user_id VARCHAR(255) NOT NULL,              -- Discord User ID
    leg VARCHAR(10) NOT NULL CHECK (leg IN ('Right', 'Left')), -- Ensures only 'Right' or 'Left'
    injection_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, -- Timestamp with timezone for the injection
    performed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, -- When the injection actually happened
    medication VARCHAR(100),                    -- Medication name (e.g., estradiol, progesterone)
    dose_mg NUMERIC(10,2),                      -- Dose in mg for this injection
    raw_units INT,                              -- Optional raw syringe units as logged
    created_by_admin_id VARCHAR(255),           -- Admin who logged on behalf of a user
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP -- Timestamp with timezone for sorting
);

-- Add indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_injections_user_id ON injections(user_id);
CREATE INDEX IF NOT EXISTS idx_injections_created_at ON injections(created_at);
CREATE INDEX IF NOT EXISTS idx_injections_performed_at ON injections(performed_at);
CREATE INDEX IF NOT EXISTS idx_injections_medication ON injections(medication);

-- Create the global settings table
CREATE TABLE IF NOT EXISTS global_settings (
    id INT PRIMARY KEY CHECK (id = 1),          -- Enforce only one row with id = 1
    injection_day INT NOT NULL CHECK (injection_day >= 0 AND injection_day <= 6), -- 0 (Sun) to 6 (Sat)
    injection_time VARCHAR(5) NOT NULL CHECK (injection_time ~ '^[0-2]\d:[0-5]\d$'), -- HH:MM format
    timezone VARCHAR(100) NOT NULL DEFAULT 'UTC', -- IANA timezone name (e.g., 'UTC', 'America/New_York')
    interval_days NUMERIC(6,2) NOT NULL DEFAULT 7, -- Flexible cadence (e.g., 3.5 days, 10 days, 30 days)
    start_time TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, -- Anchor for interval-based scheduling
    medication VARCHAR(100) DEFAULT 'Injection', -- Medication name for reminders
    dose_mg NUMERIC(10,2), -- Default dose in mg for reminders
    test_start_time TIMESTAMPTZ,              -- Anchor for hormone test reminders
    test_interval_days NUMERIC(6,2) DEFAULT 30, -- Interval for hormone test reminders (e.g., 30 days)
    test_timezone VARCHAR(100) DEFAULT 'UTC', -- Timezone for hormone test reminders
    last_run_at TIMESTAMPTZ,                 -- Scheduler last run (injection reminders)
    test_last_run_at TIMESTAMPTZ             -- Scheduler last run (test reminders)
);

-- Optional: Insert a default settings row if it doesn't exist.
-- The bot's 'setinjectionschedule' command should handle creating/updating this row.
-- You might run this manually once after creating the table if needed.
-- INSERT INTO global_settings (id, injection_day, injection_time, timezone)
-- VALUES (1, 0, '09:00', 'UTC')
-- ON CONFLICT (id) DO NOTHING;

-- Add comment explaining the schema setup
COMMENT ON TABLE injections IS 'Stores individual injection records for users.';
COMMENT ON TABLE global_settings IS 'Stores the global injection schedule settings (only row with id=1 is used).';

-- Admin action audit log
CREATE TABLE IF NOT EXISTS admin_actions (
    id SERIAL PRIMARY KEY,
    admin_user_id VARCHAR(255) NOT NULL,
    target_user_id VARCHAR(255),
    action VARCHAR(50) NOT NULL,
    log_id INT,
    details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_admin ON admin_actions(admin_user_id);

-- Migration hint (run manually on existing DB):
-- ALTER TABLE injections
--   ALTER COLUMN injection_date TYPE TIMESTAMPTZ USING to_timestamp(injection_date, 'DD-MM-YYYY'),
--   ALTER COLUMN injection_date SET DEFAULT CURRENT_TIMESTAMP,
--   ADD COLUMN IF NOT EXISTS performed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
--   ADD COLUMN IF NOT EXISTS medication VARCHAR(100),
--   ADD COLUMN IF NOT EXISTS dose_mg NUMERIC(10,2),
--   ADD COLUMN IF NOT EXISTS raw_units INT,
--   ADD COLUMN IF NOT EXISTS created_by_admin_id VARCHAR(255);
--
-- ALTER TABLE global_settings
--   ADD COLUMN IF NOT EXISTS interval_days NUMERIC(6,2) NOT NULL DEFAULT 7,
--   ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
--   ADD COLUMN IF NOT EXISTS medication VARCHAR(100) DEFAULT 'Injection',
--   ADD COLUMN IF NOT EXISTS dose_mg NUMERIC(10,2),
--   ADD COLUMN IF NOT EXISTS test_start_time TIMESTAMPTZ,
--   ADD COLUMN IF NOT EXISTS test_interval_days NUMERIC(6,2) DEFAULT 30,
--   ADD COLUMN IF NOT EXISTS test_timezone VARCHAR(100) DEFAULT 'UTC';
--   ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ,
--   ADD COLUMN IF NOT EXISTS test_last_run_at TIMESTAMPTZ;

-- Log completion
\echo 'Schema setup script completed.'
