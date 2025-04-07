// src/config.ts
import dotenv from 'dotenv';
import logger from './logger';

dotenv.config();

// Function to safely get environment variables
function getEnvVariable(key: string, required: boolean = true): string {
  const value = process.env[key];
  if (!value && required) {
    logger.error(`Missing required environment variable: ${key}`);
    process.exit(1); // Exit if required variable is missing
  }
  return value || ''; // Return empty string if optional and not set
}

export const config = {
  botToken: getEnvVariable('BOT_TOKEN'),
  clientId: getEnvVariable('CLIENT_ID'),
  guildId: getEnvVariable('GUILD_ID'),
  supabaseUrl: getEnvVariable('SUPABASE_URL'),
  supabaseAnonKey: getEnvVariable('SUPABASE_ANON_KEY'),
  designatedChannelId: getEnvVariable('DESIGNATED_CHANNEL_ID'), // Add this to your .env file!
  botOwnerId: getEnvVariable('BOT_OWNER_ID', false), // Optional
};

// Validate DESIGNATED_CHANNEL_ID specifically
if (!config.designatedChannelId) {
    logger.warn('DESIGNATED_CHANNEL_ID is not set in .env. Some features might require it.');
    // Depending on strictness, you might want to exit here too if it's absolutely required.
    // process.exit(1);
}

logger.info('Configuration loaded successfully.');
