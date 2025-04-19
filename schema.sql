-- schema.sql
-- Run this script against your PostgreSQL database to create the necessary tables.

-- Create the injections table
CREATE TABLE IF NOT EXISTS injections (
    id SERIAL PRIMARY KEY,                      -- Auto-incrementing integer ID
    user_id VARCHAR(255) NOT NULL,              -- Discord User ID
    leg VARCHAR(10) NOT NULL CHECK (leg IN ('Right', 'Left')), -- Ensures only 'Right' or 'Left'
    injection_date VARCHAR(10) NOT NULL,        -- Stores date as DD-MM-YYYY string
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP -- Timestamp with timezone for sorting
);

-- Add indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_injections_user_id ON injections(user_id);
CREATE INDEX IF NOT EXISTS idx_injections_created_at ON injections(created_at);

-- Create the global settings table
CREATE TABLE IF NOT EXISTS global_settings (
    id INT PRIMARY KEY CHECK (id = 1),          -- Enforce only one row with id = 1
    injection_day INT NOT NULL CHECK (injection_day >= 0 AND injection_day <= 6), -- 0 (Sun) to 6 (Sat)
    injection_time VARCHAR(5) NOT NULL CHECK (injection_time ~ '^[0-2]\d:[0-5]\d$'), -- HH:MM format
    timezone VARCHAR(100) NOT NULL DEFAULT 'UTC' -- IANA timezone name (e.g., 'UTC', 'America/New_York')
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

-- Log completion
\echo 'Schema setup script completed.'
