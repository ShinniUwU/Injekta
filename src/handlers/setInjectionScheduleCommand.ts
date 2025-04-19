// src/handlers/setInjectionScheduleCommand.ts
import type { CommandInteraction } from 'discord.js'; // Import type
import { MessageFlags, PermissionFlagsBits } from 'discord.js'; // Import MessageFlags
import type { GlobalSettings } from '../database';
import { setGlobalSettings } from '../database';
import logger from '../logger';

const dayNameToNumber: { [key: string]: number } = {
  /* ... as before ... */ sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export async function handleSetInjectionScheduleCommand(
  interaction: CommandInteraction, // Use specific type
  triggerReschedule: () => Promise<void>,
) {
  if (!interaction.inGuild()) {
    // Use flags for reply
    await interaction.reply({
      content: 'This command can only be used in a server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (
    !interaction.member ||
    typeof interaction.member.permissions === 'string' ||
    !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
  ) {
    // Use flags for reply
    await interaction.reply({
      content:
        'You do not have permission (Administrator) to set the injection schedule.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const dayOption = interaction.options.get('day', true);
  const timeOption = interaction.options.get('time', true);
  const timezoneOption = interaction.options.get('timezone');

  if (
    typeof dayOption.value !== 'string' ||
    typeof timeOption.value !== 'string'
  ) {
    // Use flags for reply
    await interaction.reply({
      content: 'Invalid option types received.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const dayName = dayOption.value.toLowerCase();
  const time = timeOption.value;
  const timezone =
    typeof timezoneOption?.value === 'string' ? timezoneOption.value : 'UTC';

  const injection_day = dayNameToNumber[dayName];
  if (injection_day === undefined) {
    // Use flags for reply
    await interaction.reply({
      content: 'Invalid day provided. Please use Sunday, Monday, etc.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    // Use flags for reply
    await interaction.reply({
      content:
        'Invalid time format. Please use HH:MM (24-hour format, e.g., 09:00 or 14:30).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Use flags for deferReply
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const newSettings: Omit<GlobalSettings, 'id'> = {
    injection_day,
    injection_time: time,
    timezone,
  };

  const success = await setGlobalSettings(newSettings);

  if (success) {
    logger.info(
      `Injection schedule updated by ${interaction.user.tag} to ${dayName} at ${time} (${timezone}).`,
    );
    try {
      await triggerReschedule();
      await interaction.editReply(
        `Injection schedule updated to ${dayOption.value} at ${time} (${timezone}). The scheduler has been updated.`,
      );
      logger.info('Scheduler successfully updated following schedule change.');
    } catch (rescheduleError) {
      logger.error(
        'Failed to update the live schedule after database update:',
        rescheduleError,
      );
      await interaction.editReply(
        `Injection schedule updated in the database to ${dayOption.value} at ${time} (${timezone}), but failed to update the live schedule. Please restart the bot to apply changes.`,
      );
    }
  } else {
    logger.error(
      `Failed to update injection schedule in database for ${interaction.user.tag}.`,
    );
    await interaction.editReply({
      content:
        'There was an error updating the injection schedule in the database.',
      // No need for embeds/components if just sending content
    });
  }
}
