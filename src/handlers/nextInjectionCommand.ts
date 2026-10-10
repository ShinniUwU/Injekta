// src/handlers/nextInjectionCommand.ts
import type { CommandInteraction } from 'discord.js'; // Import type
import { EmbedBuilder, MessageFlags } from 'discord.js'; // Import MessageFlags
import { getUserSchedule } from '../database';
import { guildIdOf } from '../utils/access';
import logger from '../logger'; // Import logger
import { DateTime } from 'luxon';
import {
  describeTimeUntil,
  formatDateTimeForDisplay,
  formatTimestampForDisplay,
  getNextInjectionDateTime,
  isValidTimeZone,
} from '../time';

export async function handleNextInjectionCommand(
  interaction: CommandInteraction,
) {
  // Use specific type
  // Use flags for deferReply
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guildId = guildIdOf(interaction);
  const settings = await getUserSchedule(guildId, interaction.user.id);
  if (!settings) {
    await interaction.editReply(
      'No schedule yet. Set one with `/myschedule set`.',
    );
    return;
  }

  try {
    const timezone = isValidTimeZone(settings.timezone)
      ? settings.timezone
      : 'UTC';
    const now = DateTime.now().setZone(timezone);
    const nextInjection = getNextInjectionDateTime(settings, now);

    if (!nextInjection) {
      await interaction.editReply(
        'Unable to calculate the next injection time. Please check the configured schedule.',
      );
      return;
    }

    const { days, hours, minutes, seconds } = describeTimeUntil(
      nextInjection,
      now,
    );

    const nextInjectionStr = formatDateTimeForDisplay(
      nextInjection,
      interaction.locale ?? 'en-US',
      timezone,
    );

    const medLabel = settings.medication || 'Injection';
    const doseLabel =
      settings.dose_mg !== null && settings.dose_mg !== undefined
        ? `${settings.dose_mg} mg`
        : 'Unspecified';
    const anchorLabel = settings.start_time
      ? formatTimestampForDisplay(
          settings.start_time,
          interaction.locale ?? 'en-US',
          timezone,
        )
      : 'Not set';

    const embed = new EmbedBuilder()
      .setTitle('Time Until Next Injection')
      .setDescription(
        `Approximately:
**${days}** day(s)
**${hours}** hour(s)
**${minutes}** minute(s)
**${seconds}** second(s)
until the next injection.

Scheduled for: **${nextInjectionStr}**
(Based on your schedule: every ${settings.interval_days} day(s), first anchor ${anchorLabel})
Medication: **${medLabel}**
Dose: **${doseLabel}**
Timezone: **${timezone}**
`,
      )
      .setColor(0x3498db)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    logger.error('Error calculating next injection time:', error);
    await interaction.editReply(
      'There was an error calculating the next injection time.',
    );
  }
}
