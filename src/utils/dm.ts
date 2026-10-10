import type { User } from 'discord.js';
import logger from '../logger';

// Sends a short DM so people find out right away if their DMs are closed.
export async function canDm(user: User, message: string): Promise<boolean> {
  try {
    await user.send(message);
    return true;
  } catch (error) {
    logger.warn(`Could not DM user ${user.id}`, { error });
    return false;
  }
}

export const DM_CLOSED_HINT =
  "I couldn't DM you, so you won't get reminders yet. Allow DMs from server members (Server menu > Privacy Settings), or use `/privacy reminders:channel`.";
