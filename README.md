# Injekta

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
**Injekta** is a Discord bot built with TypeScript designed to help manage and track Hormone Replacement Therapy (HRT) injections. It logs injection data (alternating between 'Right' and 'Left' legs), tracks medication and dose, supports flexible cadences (e.g., every 3.5 days, 10 days, or monthly), automatically keeps only the last 5 records per user, and sends reminders—all integrated with a **self-hosted PostgreSQL database** for persistent data storage.

## Features

- **Simple Logging:** Log injections easily using the `/injection` command with button confirmation; optionally record medication name and dose (mg).
- **Automatic Leg Alternation:** The bot automatically determines whether the 'Right' or 'Left' leg is next based on your previous log.
- **Log History:** View your last 5 injection logs using `/checklogs` (now includes medication and dose). Older logs are automatically removed.
- **Stats Tracking:** Check your total logged injections and current weekly streak with `/stats`.
- **Scheduling & Reminders:**
  - Set a global injection schedule (day, time, timezone, interval) using `/setinjectionschedule` (Admin-only) with non-weekly cadences like every 3.5 days or every 10/30 days.
  * Receive automatic reminders 1 hour before the scheduled time in a designated channel, including medication name and dose.
  * Receive a prompt in the designated channel when it's time to log your injection.
- **Hormone Test Reminders:** Set monthly (or custom interval) E/T lab reminders starting from a chosen date using `/sethormonetest`.
- **Dosing Helpers:** Convert syringe units to mg with `/convertunits` (requires vial concentration).
- **Log Deletion:**
    - Users can delete their own latest log (or a specific one by ID) using `/deletemylog` (with confirmation).
    - Admins can delete any specific log entry for any user using `/admindeletelog`.
- **Admin Tools:**
  - Admins can check logs (`/checklogs user:@username`) and stats (`/stats user:@username`) for other users.
  - Admins can log injections for other users using the `/logfor user:@username` command.
- **Persistent Storage:** All injection records and settings are stored securely in a PostgreSQL database.
- **Modern Development Stack:**
  - Built with TypeScript and Discord.js v14.
  - Uses `pg` (node-postgres) for database interaction.
  - Uses `node-cron` for scheduling.
  - Includes ESLint, Prettier, Husky, and lint-staged for code quality and Git hooks.
  - Uses Winston for structured and readable logging.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Database Setup](#database-setup)
- [Configuration](#configuration)
  - [Environment Variables](#environment-variables)
- [Usage](#usage)
  - [Running the Bot](#running-the-bot)
  - [Available Commands](#available-commands)
- [Development](#development)
  - [Linting & Formatting](#linting--formatting)
- [Contributing](#contributing)
- [License](#license)

## Prerequisites

- Node.js (v18 or higher recommended)
- Bun (or npm/yarn for package management)
- Git
- Access to a **PostgreSQL database server** (v12 or higher recommended)

## Installation

1.  **Clone the Repository:**
    ```bash
    git clone [https://github.com/ShinniUwU/Injekta.git](https://github.com/ShinniUwU/Injekta.git)
    cd Injekta
    ```

2.  **Install Dependencies:**
    Using Bun (recommended):
    ```bash
    bun install
    ```
    Using npm:
    ```bash
    npm install
    ```

3.  **Set Up Git Hooks (Optional but Recommended):**
    Initialize Husky hooks (used for pre-commit linting/formatting):
    ```bash
    bun run prepare
    # or npm run prepare
    ```
    *(Proceed to [Database Setup](#database-setup) next)*

## Database Setup

This bot requires a running PostgreSQL database server.

1.  **Ensure PostgreSQL is Running:** Install and run PostgreSQL on your local machine or server. Refer to the official PostgreSQL documentation for your operating system:
    * [PostgreSQL Downloads](https://www.postgresql.org/download/) (Choose your OS)
    * Example setup commands for [Debian/Ubuntu](https://www.postgresql.org/download/linux/debian/) or [Fedora](https://www.postgresql.org/download/linux/redhat/).

2.  **Create Database and User:** Connect to your PostgreSQL instance (e.g., using `psql`) and create a dedicated database and user for the bot. Replace `your_secure_password` with a strong password.

    ```sql
    -- Example commands using psql:
    CREATE DATABASE injekta_db;
    CREATE USER injekta_user WITH PASSWORD 'your_secure_password';
    GRANT ALL PRIVILEGES ON DATABASE injekta_db TO injekta_user;
    ```

3.  **Create Database Schema:** Navigate to the project directory (`Injekta`) in your terminal and use the `psql` client to run the provided `schema.sql` script. This will create the necessary tables (`injections`, `global_settings`). Replace placeholders with your actual connection details.

    ```bash
    psql -h <hostname> -p <port> -U injekta_user -d injekta_db -f schema.sql
    ```
    *(Example: `psql -h localhost -p 5432 -U injekta_user -d injekta_db -f schema.sql`)*
    Enter the password for `injekta_user` when prompted.

    > Upgrading from an older schema? Run the following before the bot restarts to migrate `injection_date` from the old `DD-MM-YYYY` string to a proper timestamptz:
    > ```sql
    > ALTER TABLE injections
    >   ALTER COLUMN injection_date TYPE TIMESTAMPTZ USING to_timestamp(injection_date, 'DD-MM-YYYY'),
    >   ALTER COLUMN injection_date SET DEFAULT CURRENT_TIMESTAMP;
    > ```

## Configuration

### Environment Variables

Create a `.env` file in the root of the project directory (`Injekta/.env`). Copy the following variables and fill them with your specific credentials:

```env
# Discord Bot Credentials
BOT_TOKEN=your_discord_bot_token             # Your bot's secret token
CLIENT_ID=your_discord_client_id             # Your bot's application ID
GUILD_ID=your_discord_guild_id               # The ID of the server where commands will be registered initially

# PostgreSQL Database Connection URL
# Format: postgresql://<user>:<password>@<host>:<port>/<database_name>
DATABASE_URL=postgresql://injekta_user:your_secure_password@localhost:5432/injekta_db

# Bot Configuration
DESIGNATED_CHANNEL_ID=your_discord_channel_id  # ID of the channel for reminders and '/injection' command
BOT_OWNER_ID=your_discord_user_id              # Optional: Your Discord user ID for potential owner-specific checks
````

Replace placeholders like `<user>`, `<password>`, `<host>`, `<port>`, `<database_name>` in `DATABASE_URL` with the actual values for your PostgreSQL setup created in the [Database Setup](https://www.google.com/search?q=%23database-setup) step.

**Timezone:** `/setinjectionschedule` validates the timezone you pass (IANA names like `UTC`, `America/New_York`). Invalid values are rejected and scheduler falls back to UTC if misconfigured.

## Usage

### Running the Bot

  * **Development:** For local testing and development:
    ```bash
    bun run dev
    ```
  * **Production/Deployment:** For running the bot continuously on a server, it's highly recommended to use a process manager like `pm2`:
    ```bash
    # Install pm2 globally (if not already installed)
    npm install -g pm2
    # or bun install -g pm2

    # Start the bot with pm2
    # Make sure you are in the project directory
    pm2 start bun --name injekta -- run dev
    # Or specify the script directly:
    # pm2 start src/bot.ts --name injekta --interpreter bun

    # Optional: Save the pm2 process list to restart automatically on server reboot
    pm2 save

    # Monitor logs
    pm2 logs injekta

    # Stop the bot
    pm2 stop injekta
    ```

### Available Commands

  * `/injection [dose_mg] [medication] [performed_at] [raw_units]`: Log your injection (requires confirmation). Must be used in the designated channel. Use `performed_at` to backfill and optionally log raw syringe units.
  * `/checklogs [user]`: Display the last 5 injection logs for yourself or the specified user (user option requires Admin permissions).
  * `/stats [user]`: Show injection statistics (total logs, current streak) for yourself or the specified user (user option requires Admin permissions).
  * `/nextinjection`: Check the approximate time remaining until the next scheduled injection based on the global schedule.
  * `/deletemylog [log_id]`: Delete one of your own log entries. If `log_id` is provided, deletes that specific entry. If omitted, deletes your most recent entry (requires confirmation).
  * `/setinjectionschedule <day> <time> [timezone] [interval_days] [medication] [dose_mg]` (Admin-only): Set the global injection schedule (day of week, HH:MM time, optional IANA timezone like 'UTC' or 'America/New\_York', interval in days to allow cadences like 3.5d/10d/30d, optional default medication/dose for reminders).
  * `/sethormonetest [start_date] [interval_days] [timezone]` (Admin-only): Set E/T lab reminders starting from now or a specific date, repeating every N days (default 30).
  * `/logfor <user> [dose_mg] [medication]` (Admin-only): Log an injection for the specified user.
  * `/convertunits <units> <concentration_mg_per_ml>`: Convert syringe units to mg (assumes 100 units = 1 mL).
  * `/admindeletelog <user> <log_id>` (Admin-only): Delete a specific log entry (using its unique ID) for the specified user.

## Development

### Linting & Formatting

This project uses ESLint for linting and Prettier for code formatting. Git hooks are set up using Husky and lint-staged to automatically lint and format code on commit.

  * Check formatting: `bun run prettier-check`
  * Apply formatting: `bun run prettier-write`
  * Run linter: `bun run lint`

## Contributing

Contributions are welcome\! Please feel free to submit a Pull Request or open an Issue.

## License

This project is licensed under the MIT License - see the [LICENSE](https://www.google.com/search?q=LICENSE) file for details.
