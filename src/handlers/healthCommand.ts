import type { CommandInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { pingDatabase } from '../database';
import { getSchedulerStatus } from '../scheduler';
import { hasAdminPermission } from '../utils/permissions';

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
  const scheduler = getSchedulerStatus();

  const lines = [
    `Database: **${dbOk ? 'ok' : 'unreachable'}**`,
    `Scheduler initialized: **${scheduler.initialized ? 'yes' : 'no'}**`,
    `Prompt scheduled: **${scheduler.promptScheduled ? 'yes' : 'no'}**${
      scheduler.nextPromptISO ? ` (next ${scheduler.nextPromptISO})` : ''
    }`,
    `Reminder scheduled: **${scheduler.reminderScheduled ? 'yes' : 'no'}**${
      scheduler.nextReminderISO ? ` (next ${scheduler.nextReminderISO})` : ''
    }`,
    `Nag active: **${scheduler.nagActive ? 'yes' : 'no'}**${
      scheduler.nagDeadlineISO ? ` (until ${scheduler.nagDeadlineISO})` : ''
    }`,
    `Timezone: **${scheduler.timezone ?? 'unknown'}**`,
  ];

  await interaction.editReply({ content: lines.join('\n') });
}
