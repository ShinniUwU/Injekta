import type { CommandInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { snoozeNag } from '../scheduler';

export async function handleSnoozeCommand(interaction: CommandInteraction) {
  const hoursOption = interaction.options.get('hours');
  const hours =
    hoursOption && typeof hoursOption.value === 'number'
      ? hoursOption.value
      : null;

  if (hours === null || hours <= 0) {
    await interaction.reply({
      content: 'Please provide a valid number of hours.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const result = snoozeNag(hours);

  if (result === 'no-active-nag') {
    await interaction.reply({
      content: 'No active injection nag to snooze right now.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: `Snoozed. Next nag ping in ${hours}h.`,
    flags: MessageFlags.Ephemeral,
  });
}
