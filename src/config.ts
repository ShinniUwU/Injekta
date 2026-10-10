// src/config.ts
import dotenv from 'dotenv';
import logger from './logger';

dotenv.config();

// Function to safely get environment variables
function getEnvVariable(key: string, required = true): string {
  const value = process.env[key];
  if (!value && required) {
    logger.error(`Missing required environment variable: ${key}`);
    process.exit(1); // Exit if required variable is missing
  }
  return value || ''; // Return empty string if optional and not set
}

// Optional: only used to move data from the old single-server setup into
// GUILD_ID's per-server settings. New servers use /setchannel instead.
const designatedChannelId = getEnvVariable('DESIGNATED_CHANNEL_ID', false);
const versionNotifyChannelId =
  getEnvVariable('VERSION_NOTIFY_CHANNEL_ID', false) || designatedChannelId;

export const config = {
  botToken: getEnvVariable('BOT_TOKEN'),
  clientId: getEnvVariable('CLIENT_ID'),
  // Optional in production (global commands); used for dev command registration
  guildId: getEnvVariable('GUILD_ID', false),
  // Replace Supabase vars with DATABASE_URL
  databaseUrl: getEnvVariable('DATABASE_URL'), // e.g., postgresql://user:password@host:port/database
  designatedChannelId,
  versionNotifyChannelId,
  botOwnerId: getEnvVariable('BOT_OWNER_ID', false), // Optional
};

// Validate Database URL format (basic check)
try {
  new URL(config.databaseUrl);
} catch (e) {
  logger.error(
    'Invalid DATABASE_URL format. It should be like postgresql://user:password@host:port/database',
  );
  process.exit(1);
}

logger.info('Configuration loaded successfully.');
