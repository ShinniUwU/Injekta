# Injekta

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
**Injekta** is a Discord bot built with TypeScript designed to help manage and track Hormone Replacement Therapy (HRT) injections. It logs injection data (alternating between 'Right' and 'Left' legs), automatically keeps only the last 5 records per user, and sends weekly reminders—all integrated with Supabase for persistent data storage.

## Features

- **Simple Logging:** Log injections easily using the `/injection` command with button confirmation.
- **Automatic Leg Alternation:** The bot automatically determines whether the 'Right' or 'Left' leg is next based on your previous log.
- **Log History:** View your last 5 injection logs using `/checklogs`. Older logs are automatically removed.
- **Stats Tracking:** Check your total logged injections and current weekly streak with `/stats`.
- **Scheduling & Reminders:**
  - Set a global injection schedule (day, time, timezone) using `/setinjectionschedule` (Admin-only).
  - Receive automatic reminders 1 hour before the scheduled time in a designated channel.
  - Receive a prompt in the designated channel when it's time to log your injection.
- **Admin Tools:**
  - Admins can check logs (`/checklogs user:@username`) and stats (`/stats user:@username`) for other users.
  - Admins can log injections for other users using the `/logfor user:@username` command.
- **Persistent Storage:** All injection records and settings are stored securely in a Supabase database.
- **Modern Development Stack:**
  - Built with TypeScript and Discord.js v14.
  - Uses `node-cron` for scheduling.
  - Includes ESLint, Prettier, Husky, and lint-staged for code quality and Git hooks.
  - Uses Winston for structured and readable logging.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Updating the Bot](#updating-the-bot)
- [Configuration](#configuration)
  - [Environment Variables](#environment-variables)
  - [Supabase Setup](#supabase-setup)
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
- Access to a Supabase project

## Installation

1.  **Clone the Repository:**

    ```bash
    git clone [https://github.com/ShinniUwU/injekta.git]
    cd injekta
    ```

2.  **Install Dependencies:**
    Using Bun:

    ```bash
    bun install
    ```

    Using npm:

    ```bash
    npm install
    ```

3.  **Install Cron Types (if using TypeScript):**

    ```bash
    # Using Bun
    bun add --dev @types/node-cron
    # Using npm
    npm install --save-dev @types/node-cron
    ```

4.  **Set Up Git Hooks:**
    Initialize Husky hooks (used for pre-commit linting/formatting):
    ```bash
    bun run prepare
    # or npm run prepare
    ```

## Updating the Bot

To get the latest changes from the GitHub repository:

1.  **Pull Changes:** Navigate to your `Injekta` project directory in your terminal and run:

    ```bash
    git pull origin main
    ```

    _(This assumes `origin` is your remote name and `main` is the branch)_

2.  **Install Dependencies (If Changed):** If the `package.json` file was updated (meaning dependencies might have changed), run the install command again:

    ```bash
    bun install
    # or npm install
    ```

3.  **Restart the Bot:** Stop the bot if it's running and start it again using `bun run dev`.

## Configuration

### Environment Variables

Create a `.env` file in the root of the project directory. Copy the following variables and fill them with your specific credentials:

```env
# Discord Bot Credentials
BOT_TOKEN=your_discord_bot_token             # Your bot's secret token
CLIENT_ID=your_discord_client_id             # Your bot's application ID
GUILD_ID=your_discord_guild_id               # The ID of the server where commands will be registered initially

# Supabase Credentials
SUPABASE_URL=[https://your-project-ref.supabase.co](https://your-project-ref.supabase.co)  # URL from your Supabase project API settings
SUPABASE_ANON_KEY=your_supabase_anon_key          # Anon key from your Supabase project API settings

# Bot Configuration
DESIGNATED_CHANNEL_ID=your_discord_channel_id  # ID of the channel for reminders and '/injection' command
BOT_OWNER_ID=your_discord_user_id              # Optional: Your Discord user ID for potential owner-specific checks
```

- You can get Discord IDs by enabling Developer Mode in Discord Settings -> Advanced, then right-clicking on the server/channel/user and selecting "Copy ID" / "Copy Channel ID" / "Copy User ID".

### Supabase Setup

You need two tables in your Supabase database. Go to the Supabase SQL Editor in your project dashboard and run the following queries:

1.  **Create `injections` Table:**

    ```sql
    CREATE TABLE injections (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,          -- Discord User ID
      leg TEXT NOT NULL,              -- Stores 'Right' or 'Left'
      injection_date TEXT NOT NULL,   -- Date in DD-MM-YYYY format
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL -- Timestamp of when the record was created
    );
    ```

2.  **Create `global_settings` Table:**

    ```sql
    CREATE TABLE global_settings (
      id INT PRIMARY KEY CHECK (id = 1), -- Ensure only one row with id = 1 exists
      injection_day INT NOT NULL,         -- Day of week: 0 = Sunday, ..., 6 = Saturday
      injection_time TEXT NOT NULL,       -- Time in HH:MM (24-hour format, e.g., "14:30")
      timezone TEXT NOT NULL              -- Timezone name (e.g., "UTC", "Europe/Sofia", "America/New_York")
    );
    ```

3.  **Insert Initial Settings:** (Required for the scheduler to work)
    ```sql
    -- Example: Set default schedule to Saturday at 11:00 AM UTC
    INSERT INTO global_settings (id, injection_day, injection_time, timezone)
    VALUES (1, 6, '11:00', 'UTC')
    ON CONFLICT (id) DO NOTHING; -- Prevents error if settings already exist
    ```
    _(Adjust the values `6`, `'11:00'`, and `'UTC'` to your desired default schedule)._

## Usage

### Running the Bot

To run the bot directly using `bun` (which executes TypeScript):

```bash
bun run dev
```

_(This command uses the `dev` script defined in your `package.json`. Make sure the `dev` script correctly points to your main bot file, e.g., `"dev": "bun src/bot.ts"` or `"dev": "bun run src/index.ts"` if index.ts starts your bot.)_

This will start the bot. There is no separate build step required with this method.

### Available Commands

- `/injection`: Logs your own injection for the current day. The bot determines the correct leg ('Right' or 'Left') and asks for confirmation via buttons. Automatically keeps only the last 5 logs.
- `/checklogs [user: @username]`: Shows the last 5 injection logs. If `user` is specified, shows logs for that user (requires Admin permission). Defaults to showing your own logs.
- `/stats [user: @username]`: Shows injection statistics (total logged, current streak). If `user` is specified, shows stats for that user (requires Admin permission). Defaults to showing your own stats.
- `/nextinjection`: Calculates and displays the approximate time remaining until the next scheduled injection based on global settings.
- `/setinjectionschedule day:<Day> time:<HH:MM> [timezone:<Timezone>]`: **(Admin Only)** Sets or updates the global injection schedule (day of the week, time, and optional timezone like "Europe/Sofia"). The scheduler updates dynamically.
- `/logfor user:<@username>`: **(Admin Only)** Logs an injection for the specified `user`. Useful if someone forgets or needs assistance logging.

## Development

### Linting & Formatting

- **Check Code with ESLint:**
  ```bash
  bun run lint
  # or npm run lint
  ```
- **Check Formatting with Prettier:**
  ```bash
  bun run prettier-check
  # or npm run prettier-check
  ```
- **Automatically Format Code with Prettier:**
  ```bash
  bun run prettier-write
  # or npm run prettier-write
  ```
- Linting and formatting are also run automatically on commit via Husky and lint-staged.

## Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the [issues page](https://github.com/ShinniUwU/injekta/issues).

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
