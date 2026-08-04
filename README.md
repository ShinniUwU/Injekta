# Injekta

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Injekta** is a self-hosted Discord bot for tracking HRT injections. It alternates legs automatically, tracks medication and dose, supports flexible schedules (e.g. every 3.5, 7, 10, or 30 days), keeps your last 5 logs per user, and fires reminders — all backed by a PostgreSQL database.

## Features

- **Injection logging** — `/injection` with button confirmation. Dose, medication, and raw units are optional.
- **Automatic leg alternation** — always knows whether Right or Left is next based on your last log.
- **Log history** — `/checklogs` shows your last 5 entries with dates, leg, medication, and dose.
- **Stats** — `/stats` shows total injections logged and current streak.
- **Reminders** — 1-hour warning + on-time prompt posted in the designated channel, including medication and dose. Reminders tag `BOT_OWNER_ID` if set.
- **Injection nag** — if the on-time prompt goes unlogged, pings hourly for up to 12 hours; `/snooze <hours>` pushes it back.
- **Catch-up reminders** — if the bot was offline and missed a scheduled reminder, it sends one on restart.
- **Hormone test reminders** — `/sethormonetest` sets recurring E/T lab reminders at a custom interval.
- **Dosing helper** — `/convertunits` converts raw syringe units to mg given a vial concentration.
- **Log deletion** — `/deletemylog` lets users delete their own latest or a specific log (with confirmation). Admins use `/admindeletelog`.
- **Admin tools** — admins can view logs/stats for any user, log injections on behalf of users with `/logfor`, and manage entries.
- **Update alerts** — on startup and every 6 hours, the bot checks its git remote. If commits are available it posts a notice in the configured channel.
- **Persistent storage** — everything lives in PostgreSQL. Restarting or updating the bot loses nothing.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Database Setup](#database-setup)
- [Configuration](#configuration)
- [Running the Bot](#running-the-bot)
- [Updating the Bot](#updating-the-bot)
- [Available Commands](#available-commands)
- [Development](#development)
- [License](#license)

## Prerequisites

- [Bun](https://bun.sh) (recommended runtime)
- Git
- PostgreSQL (v12 or higher)

## Installation

```bash
git clone https://github.com/ShinniUwU/Injekta.git
cd Injekta
bun install
bun run prepare   # sets up Husky pre-commit hooks (optional)
```

## Database Setup

1. **Create a database and user** in your PostgreSQL instance:

    ```sql
    CREATE DATABASE injekta_db;
    CREATE USER injekta_user WITH PASSWORD 'your_secure_password';
    GRANT ALL PRIVILEGES ON DATABASE injekta_db TO injekta_user;
    ```

2. **Apply the schema:**

    ```bash
    psql -h localhost -p 5432 -U injekta_user -d injekta_db -f schema.sql
    ```

    This creates the `injections`, `global_settings`, and `admin_actions` tables.

> **Upgrading from an older schema?** If your `injection_date` column was stored as a `DD-MM-YYYY` string, migrate it before restarting:
> ```sql
> ALTER TABLE injections
>   ALTER COLUMN injection_date TYPE TIMESTAMPTZ
>     USING to_timestamp(injection_date, 'DD-MM-YYYY'),
>   ALTER COLUMN injection_date SET DEFAULT CURRENT_TIMESTAMP;
> ```

## Configuration

Copy `.env.example` to `.env` and fill in your values:

```env
# Discord
BOT_TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_application_id
GUILD_ID=your_discord_server_id

# Database
DATABASE_URL=postgresql://injekta_user:your_secure_password@localhost:5432/injekta_db

# Channels
DESIGNATED_CHANNEL_ID=channel_id_for_injection_logs_and_reminders
VERSION_NOTIFY_CHANNEL_ID=channel_id_for_update_alerts  # optional, falls back to DESIGNATED_CHANNEL_ID

# Optional
BOT_OWNER_ID=your_discord_user_id
```

**Timezone:** `/setinjectionschedule` accepts IANA timezone names (e.g. `UTC`, `Europe/London`, `America/New_York`). Invalid values are rejected; the scheduler falls back to UTC.

## Running the Bot

**Development:**
```bash
bun run dev
```

**Production (pm2):**
```bash
npm install -g pm2
pm2 start bun --name injekta -- run dev
pm2 save          # auto-restart on server reboot
pm2 logs injekta  # tail logs
pm2 stop injekta  # stop
```

**First-run checklist:**
1. Start the bot.
2. Run `/setupcheck` in Discord to verify DB connection and channel access.
3. Run `/setinjectionschedule` (admin) to configure the schedule — reminders and `/nextinjection` won't work until this is done.
4. Optionally run `/sethormonetest` (admin) to enable E/T lab reminders.

## Updating the Bot

No action is required from end users — everything is stored in PostgreSQL and survives restarts.

On the server:

```bash
git pull
bun install       # only needed if bun.lockb changed
pm2 restart injekta
```

The scheduler re-reads all settings from the database on startup and picks up exactly where it left off. If a reminder was missed while the bot was offline, a catch-up notice is sent automatically.

**If a future update adds new database columns or tables**, run the relevant `ALTER TABLE` / `CREATE TABLE` SQL against the live database before restarting the bot. Keep `schema.sql` in sync when this happens.

## Available Commands

| Command | Description | Who |
|---------|-------------|-----|
| `/injection [dose_mg] [medication] [performed_at] [raw_units]` | Log an injection | Everyone |
| `/checklogs [user]` | View last 5 injection logs | Everyone (admin for others) |
| `/nextinjection` | Show when the next injection is due | Everyone |
| `/snooze <hours>` | Push the current injection nag back by N hours | Everyone |
| `/stats [user]` | Total logs and streak | Everyone (admin for others) |
| `/deletemylog [log_id]` | Delete your latest log or a specific one by ID | Everyone |
| `/convertunits <units> <concentration_mg_per_ml>` | Convert syringe units to mg | Everyone |
| `/help` | Show command overview | Everyone |
| `/timecheck` | Show current time in the configured timezone | Everyone |
| `/health` | Check bot and database status | Everyone |
| `/setinjectionschedule <day> <time> [timezone] [interval_days] [medication] [dose_mg]` | Configure the global injection schedule | Admin |
| `/sethormonetest [start_date] [interval_days] [timezone]` | Configure hormone test reminders | Admin |
| `/logfor <user> [dose_mg] [medication]` | Log an injection for another user | Admin |
| `/admindeletelog <user> <log_id>` | Delete any user's log entry | Admin |
| `/updatecheck` | Manually check for available git updates | Admin |
| `/setupcheck` | Verify DB connection and channel config | Admin |

## Development

```bash
bun run lint            # ESLint
bun run prettier-check  # check formatting
bun run prettier-write  # apply formatting
```

Git hooks (Husky + lint-staged) run ESLint and Prettier automatically on commit.

**Stack:** TypeScript · Discord.js v14 · pg (node-postgres) · Luxon · Winston · Bun

## License

MIT — see [LICENSE](LICENSE).
