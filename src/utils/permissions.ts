import type { CommandInteraction } from 'discord.js';
import { PermissionFlagsBits } from 'discord.js';

export function hasAdminPermission(interaction: CommandInteraction): boolean {
  if (!interaction.member) return false;
  const permissions = interaction.member.permissions;
  if (typeof permissions === 'string') return false;
  return permissions.has(PermissionFlagsBits.Administrator);
}
