import type { CommandInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { pingDatabase } from '../database';
import { getSchedulerStatus } from '../scheduler';
import { hasAdminPermission } from '../utils/permissions';
import { guildIdOf } from '../utils/access';

export async function handleHealthCommand(interaction: CommandInteraction) {
  if (!interaction.inGuild() || !hasAdminPermission(interaction)) {
    await interaction.reply({
      content: 'Admin only.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const dbOk = await pingDatabase();
  const scheduler = getSchedulerStatus(guildIdOf(interaction));

  const lines = [
    `Database: **${dbOk ? 'ok' : 'unreachable'}**`,
    `Scheduler initialized: **${scheduler.initialized ? 'yes' : 'no'}**`,
    `Hormone test reminder: ${scheduler.nextTestISO ?? 'not set'}`,
    // Counts only: admins shouldn't learn who has a schedule or a pending nag
    `Personal schedules in this server: **${scheduler.personalSchedules}**`,
    `Active nags: **${scheduler.activeNags}**`,
  ];

  await interaction.editReply({ content: lines.join('\n') });
}
