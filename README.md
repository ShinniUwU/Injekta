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

````
