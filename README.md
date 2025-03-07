# Injekta

**Injekta** is a Discord bot built with TypeScript that helps you manage and track your HRT injections. It logs your injection data, alternates the injection leg, and sends weekly reminders—all while integrating with Supabase for persistent data storage.

## Features

- **Slash Commands:**
  - **/injection**: Log your injection after confirming with an interactive button.
  - **/checklogs**: View the last 5 injection logs in a neat embed.
  - **/nextinjection**: Check how much time remains until your next injection.
  - **/setinjectionschedule** (Admin Only): Update the global injection schedule.
  - **/stats**: View your injection statistics (total injections and current streak).

- **Automatic Reminders:**
  - The bot automatically sends weekly prompts and a reminder 1 hour before your scheduled injection time in a designated channel.

- **Supabase Integration:**
  - Records are stored in Supabase, allowing persistent tracking of injection data and global settings.

- **Modern Development Workflow:**
  - Built with TypeScript.
  - Uses ESLint and Prettier for code quality and consistency.
  - Uses ts-node-dev for fast auto-reloading during development.
  - Husky and lint-staged ensure that code style is enforced on commits.
  - Winston provides robust logging for runtime information and errors.

## Table of Contents

- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
  - [Running the Bot](#running-the-bot)
  - [Available Commands](#available-commands)
- [Development](#development)
  - [Linting & Formatting](#linting--formatting)
- [Contributing](#contributing)
- [License](#license)

## Installation

1. **Clone the Repository:**

   ```bash
   git clone https://github.com/yourusername/injekta.git
   cd injekta
   ```

2. **Install Dependencies:**

   If you're using Bun:

   ```bash
   bun install
   ```

   Otherwise, if using npm:

   ```bash
   npm install
   ```

3. **Set Up Husky:**

   Initialize Husky hooks by running:

   ```bash
   bun run prepare
   ```

## Configuration

Create a `.env` file in the root of your project with the following variables:

```env
BOT_TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_client_id
GUILD_ID=your_discord_guild_id
SUPABASE_URL=https://your-supabase-project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key
```

For admin commands, you can optionally add:

```env
BOT_OWNER_ID=your_discord_id
```

Ensure your Supabase database has the following tables:

### Injections Table

```sql
CREATE TABLE injections (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  leg TEXT NOT NULL,
  injection_date TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
```

### Global Settings Table

```sql
CREATE TABLE global_settings (
  id INT PRIMARY KEY,
  injection_day INT NOT NULL,  -- 0 = Sunday, …, 6 = Saturday
  injection_time TEXT NOT NULL, -- e.g., "09:00"
  timezone TEXT NOT NULL        -- e.g., "UTC" or "America/New_York"
);

-- Insert default settings:
INSERT INTO global_settings (id, injection_day, injection_time, timezone)
VALUES (1, 6, '09:00', 'UTC');
```

## Usage

### Running the Bot

- **Development Mode:**  
  Run the bot with:

  ```bash
  bun run dev
  ```

  This uses ts-node-dev for hot reloading.

- **Build:**  
  To compile the TypeScript files to JavaScript:

  ```bash
  bun run build
  ```

### Available Commands

- **/injection:**  
  Log your injection after confirming via an interactive button.
  
- **/checklogs:**  
  View the last 5 injection logs in a formatted embed.

- **/nextinjection:**  
  See how much time is remaining until your next injection (displayed in months, days, hours, and minutes).

- **/setinjectionschedule (Admin Only):**  
  Update the global injection schedule. Accepts parameters: day (e.g., "Saturday"), time (e.g., "09:00"), and optionally timezone.

- **/stats:**  
  View your injection statistics, including total injections and your current streak.

## Development

### Linting & Formatting

- **ESLint:**  
  Check your code by running:

  ```bash
  bun run lint
  ```

- **Prettier:**  
  To check formatting:

  ```bash
  bun run prettier-check
  ```

  To automatically format your code:

  ```bash
  bun run prettier-write
  ```

### Testing

Currently, there are no tests set up. You can add tests later if needed.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request if you have suggestions, bug fixes, or new features.

## License

This project is licensed under the [MIT License](LICENSE).
