// src/handlers/nextInjectionCommand.ts
import type { CommandInteraction } from 'discord.js'; // Import type
import { EmbedBuilder, MessageFlags } from 'discord.js'; // Import MessageFlags
import { getGlobalSettings } from '../database';
import logger from '../logger'; // Import logger

export async function handleNextInjectionCommand(
  interaction: CommandInteraction,
) {
  // Use specific type
  // Use flags for deferReply
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const settings = await getGlobalSettings();
  if (!settings) {
    await interaction.editReply(
      'Global injection schedule not set. Please contact an admin.',
    );
    return;
  }

  try {
    const now = new Date();
    const [hourStr, minuteStr] = settings.injection_time.split(':');
    const hour = parseInt(hourStr, 10);
    const minute = parseInt(minuteStr, 10);

    if (isNaN(hour) || isNaN(minute)) {
      throw new Error(
        `Invalid time format in settings: ${settings.injection_time}`,
      );
    }

    let nextInjection = new Date(now); // Use copy of current date/time
    // Set time based on settings - Note: this initially uses local server time zone parts
    nextInjection.setHours(hour, minute, 0, 0);

    const currentDay = now.getDay(); // 0 = Sunday
    let daysUntil = (settings.injection_day - currentDay + 7) % 7;

    // If today IS the injection day, but the scheduled time has already passed (in server's local time),
    // schedule for next week. This isn't perfect timezone-wise but matches the original logic.
    // A full timezone-aware library (like luxon, dayjs) would handle this more robustly.
    if (daysUntil === 0 && now.getTime() >= nextInjection.getTime()) {
      daysUntil = 7;
    }
    nextInjection.setDate(now.getDate() + daysUntil);

    const diffMs = nextInjection.getTime() - now.getTime();

    // Handle cases where diffMs might be negative if logic is slightly off near schedule time
    if (diffMs < 0) {
      await interaction.editReply(
        'The next injection time calculation resulted in a past date. Please check the schedule or try again shortly.',
      );
      return;
    }

    const totalSeconds = Math.floor(diffMs / 1000);
    const seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const minutes = totalMinutes % 60;
    const totalHours = Math.floor(totalMinutes / 60);
    const hours = totalHours % 24;
    const days = Math.floor(totalHours / 24);
    // Simplified month calculation (approximate)
    // const months = Math.floor(days / 30);
    // const remainingDays = days % 30;

    // Using Intl.DateTimeFormat for locale-aware date string
    const dateFormatter = new Intl.DateTimeFormat(
      interaction.locale ?? 'en-US',
      {
        dateStyle: 'full',
        timeStyle: 'short',
        // timeZone: settings.timezone // Optional: display in target timezone - might require browser/Node support
      },
    );
    const nextInjectionStr = dateFormatter.format(nextInjection);

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
(Based on schedule: Day ${settings.injection_day}, ${settings.injection_time} ${settings.timezone})`,
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
