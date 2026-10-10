# Injekta

[![License: PolyForm Noncommercial](https://img.shields.io/badge/License-PolyForm%20Noncommercial-blue.svg)](https://polyformproject.org/licenses/noncommercial/1.0.0)

**Injekta** is a privacy-first Discord bot for tracking HRT injections. It alternates legs for you, reminds you by DM on your own schedule (every 3.5, 7, 10 days, whatever you need), and keeps your logs private, even from server admins, unless you choose to share them.

## Features

- **Injection logging**: `/injection` shows which leg will be saved before you confirm, with a button to switch it. Dose, medication, and syringe units are optional.
- **Automatic leg alternation**: picks Right or Left from the injection right before this one by date, so logs added for past dates don't break the alternation. Pass `leg:` to override.
- **Fixing mistakes**: `/checklogs` flags two of the same leg in a row. Pick an entry to flip its leg, fix the date/dose/units, or delete it. `/setleg log_id:<ID> leg:<Left|Right>` does the leg fix in one command. Old logs are never changed automatically, since doing the same leg twice can be real.
- **Your own schedule**: `/myschedule set` gives each person their own day, interval, medication, and dose. Only people who set a schedule get reminders.
- **Reminders**: a 1-hour warning and an on-time prompt, by DM or in the server channel (your choice in `/privacy`). If the prompt goes unlogged, an hourly nag runs for up to 12 hours; `/snooze <hours>` pushes it back. Missed reminders are caught up after a restart.
- **Multi-server**: one bot can serve many servers. Logs, schedules, and settings are kept separately per server.
- **Hormone test reminders**: `/sethormonetest` sets recurring E/T lab reminders per server.
- **Dosing helper**: `/convertunits` converts syringe units to mg for a given vial concentration.
- **Stats**: `/stats` shows total logs and your streak of on-schedule injections.

## Privacy

Injekta handles health data, so privacy is the default:

- **Admins can't see your logs.** `/checklogs`, `/stats`, `/logfor`, `/setleg`, and `/admindeletelog` refuse to touch another person's logs unless that person runs `/privacy admin_access:allow`. The refusal looks the same whether or not you have logs, so it doesn't reveal that you use the bot.
- **Reminders go by DM** unless you pick `/privacy reminders:channel`. Channel reminders mention you but never show medication or dose.
- **All command replies are only visible to you.**
- **Minimal storage**: your Discord user ID, your last 5 logs (date, leg, and any medication/dose/units you add), your own schedule if you set one, and your privacy choices. Nothing else.
- **`/exportmydata`** sends you a JSON file of everything stored about you in that server. Only you can run it for yourself, the reply is only visible to you, and the file leaves out other people's IDs (it says whether an admin logged an entry, not which one).
- **`/deletemydata`** erases all of it for that server. When admins act on your logs (with your permission), the action is recorded in an audit table, and `/deletemydata` clears the details there too.
- **Bot logs** record IDs and actions, not doses, medication, or legs.

**What privacy mode can't do:** whoever hosts the bot has access to the database, like with any self-hosted app. If you use someone else's instance, you are trusting that person. Hosting it yourself (see below) is the most private option.

## Table of Contents

- [Quick start with Docker](#quick-start-with-docker)
- [Manual install](#manual-install)
- [Configuration](#configuration)
- [First-run checklist](#first-run-checklist)
- [Updating the Bot](#updating-the-bot)
- [Available Commands](#available-commands)
- [Development](#development)
- [License](#license)

## Quick start with Docker

Runs the bot and a PostgreSQL database together. Needs [Docker](https://docs.docker.com/get-docker/) with Compose.

```bash
git clone https://github.com/ShinniUwU/Injekta.git
cd Injekta
cp .env.example .env    # fill in BOT_TOKEN and CLIENT_ID (see Configuration)
docker compose up -d
docker compose logs -f bot
```

The database password defaults to `injekta`. To change it, set `POSTGRES_PASSWORD=...` in `.env` before the first start. `DATABASE_URL` is set for you by `docker-compose.yml`.

## Manual install

Needs [Bun](https://bun.sh), Git, and PostgreSQL 12 or newer.

```bash
git clone https://github.com/ShinniUwU/Injekta.git
cd Injekta
bun install
bun run prepare   # sets up Husky pre-commit hooks (optional)
```

Create a database and user:

```sql
CREATE DATABASE injekta_db;
CREATE USER injekta_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE injekta_db TO injekta_user;
ALTER DATABASE injekta_db OWNER TO injekta_user;
```

You don't need to apply `schema.sql` yourself: the bot runs it on every start, and it only creates what's missing.

Run it:

```bash
bun run dev                                   # foreground
pm2 start bun --name injekta -- run dev       # background with pm2
pm2 save                                      # restart on reboot
```

> **Upgrading from a very old schema?** If your `injection_date` column was stored as a `DD-MM-YYYY` string, convert it before starting the new version:
>
> ```sql
> ALTER TABLE injections
>   ALTER COLUMN injection_date TYPE TIMESTAMPTZ
>     USING to_timestamp(injection_date, 'DD-MM-YYYY'),
>   ALTER COLUMN injection_date SET DEFAULT CURRENT_TIMESTAMP;
> ```

## Configuration

Copy `.env.example` to `.env` and fill in your values:

```env
# Required
BOT_TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_application_id
DATABASE_URL=postgresql://injekta_user:your_secure_password@localhost:5432/injekta_db

# Optional
GUILD_ID=your_discord_server_id            # registers commands instantly in this server (dev mode)
BOT_OWNER_ID=your_discord_user_id          # pinged on hormone test reminders in GUILD_ID; gets the old schedule when upgrading
VERSION_NOTIFY_CHANNEL_ID=channel_id       # where update alerts go
NODE_ENV=production                        # register commands globally for every server
```

- **One server:** set `GUILD_ID`. Commands show up right away in that server.
- **Many servers / public instance:** set `NODE_ENV=production`. Commands are registered globally. The bot removes the old `GUILD_ID` copies so they don't appear twice.
- **Upgrading from the single-server version:** keep `GUILD_ID`, `DESIGNATED_CHANNEL_ID`, and `BOT_OWNER_ID` set for the first start. Your existing logs are moved to that server, the channel becomes that server's reminder channel, and the old server-wide schedule becomes `BOT_OWNER_ID`'s personal schedule (reminders now arrive by DM; use `/privacy reminders:channel` for the old behavior). After that, `DESIGNATED_CHANNEL_ID` isn't needed; use `/setchannel`.

**Timezones** use IANA names (e.g. `UTC`, `Europe/London`, `America/New_York`). Invalid values are rejected.

## First-run checklist

In each server:

1. Invite the bot with the `bot` and `applications.commands` scopes.
2. `/setchannel` (admin): where `/injection` is used and channel reminders go. Optional: without it, people can log anywhere and only DM reminders work.
3. `/setupcheck` (admin): confirms the database, channel, and schedule.
4. Members run `/myschedule set` for their own reminders and `/privacy` to see their settings.

## Updating the Bot

```bash
git pull
docker compose up -d --build     # Docker
# or
bun install && pm2 restart injekta   # manual install
```

Database changes are applied automatically on start. The scheduler re-reads everything from the database and sends a catch-up notice for anything missed while it was offline.

## Available Commands

**For everyone** (replies are only visible to you):

| Command                                                              | Description                                       |
| -------------------------------------------------------------------- | ------------------------------------------------- |
| `/injection [dose_mg] [medication] [performed_at] [raw_units] [leg]` | Log an injection                                  |
| `/checklogs`                                                         | View, edit, or delete your last 5 logs            |
| `/setleg <log_id> <leg>`                                             | Fix which leg a log was saved as                  |
| `/myschedule set <next> <every_days> [timezone] [medication] [dose]` | Set your own schedule                             |
| `/myschedule show` / `/myschedule clear`                             | See your schedule / stop reminders                |
| `/privacy [admin_access] [reminders]`                                | See or change admin access and where reminders go |
| `/exportmydata`                                                      | Download your data in this server as JSON         |
| `/deletemydata`                                                      | Delete all your logs and settings in this server  |
| `/nextinjection`                                                     | Time until your next injection                    |
| `/snooze <hours>`                                                    | Push your injection nag back                      |
| `/stats`                                                             | Total logs and streak                             |
| `/deletemylog [log_id]`                                              | Delete your latest log or a specific one          |
| `/convertunits <units> <concentration_mg_per_ml>`                    | Convert syringe units to mg                       |
| `/timecheck`                                                         | Current time in your timezone                     |
| `/help`                                                              | Walkthrough                                       |

**For admins:**

| Command                                                   | Description                                    |
| --------------------------------------------------------- | ---------------------------------------------- |
| `/setchannel <channel>`                                   | Channel for `/injection` and channel reminders |
| `/sethormonetest [start_date] [interval_days] [timezone]` | Hormone test reminders                         |
| `/checklogs user:` · `/stats user:` · `/setleg`           | Only for members who allowed admin access      |
| `/logfor <user> ...` · `/admindeletelog <user> <log_id>`  | Only for members who allowed admin access      |
| `/setupcheck` · `/health` · `/updatecheck`                | Setup check, status, update check              |

## Development

```bash
bun run lint            # ESLint
bun run test            # Jest
bun run prettier-check  # check formatting
bun run prettier-write  # apply formatting
```

Git hooks (Husky + lint-staged) run ESLint and Prettier automatically on commit.

**Stack:** TypeScript · Discord.js v14 · pg (node-postgres) · Luxon · Winston · Bun

## License

PolyForm Noncommercial 1.0.0, see [LICENSE](LICENSE). Commercial use needs a separate license.
