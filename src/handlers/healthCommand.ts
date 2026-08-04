import type { CommandInteraction } from 'discord.js';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { pingDatabase } from '../database';
import { getSchedulerStatus } from '../scheduler';

export async function handleHealthCommand(interaction: CommandInteraction) {
  if (
    !interaction.inGuild() ||
    !interaction.member ||
    typeof interaction.member.permissions === 'string' ||
    !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
  ) {
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
