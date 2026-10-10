import type { CommandInteraction } from 'discord.js';
import { getUserSettings } from '../database';
import { hasAdminPermission } from './permissions';

export const PRIVATE_LOGS_MESSAGE =
  "You can't see or change this person's logs. Logs are private unless their owner allows admin access with `/privacy admin_access:allow`.";

export function guildIdOf(interaction: CommandInteraction): string {
  if (!interaction.guildId) {
    throw new Error('Command used outside a server.');
  }
  return interaction.guildId;
}

// Owners always have access. Admins only if the owner opted in for this server.
export async function canAccessUserData(
  interaction: CommandInteraction,
  ownerId: string,
): Promise<boolean> {
  if (ownerId === interaction.user.id) return true;
  if (!interaction.inGuild() || !hasAdminPermission(interaction)) return false;
  const settings = await getUserSettings(guildIdOf(interaction), ownerId);
  return settings.share_with_admins;
}
