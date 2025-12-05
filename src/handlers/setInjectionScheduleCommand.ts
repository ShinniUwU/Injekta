// src/handlers/setInjectionScheduleCommand.ts
import type { CommandInteraction } from 'discord.js'; // Import type
import { MessageFlags, PermissionFlagsBits } from 'discord.js'; // Import MessageFlags
import type { GlobalSettings } from '../database';
import { setGlobalSettings, getGlobalSettings } from '../database';
import logger from '../logger';
import { isValidTimeZone } from '../time';
import { getAnchorDateTime } from '../time';

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
  const intervalOption = interaction.options.get('interval_days');
  const medicationOption = interaction.options.get('medication');
  const doseOption = interaction.options.get('dose_mg');

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

  if (!isValidTimeZone(timezone)) {
    await interaction.reply({
      content:
        'Invalid timezone provided. Please use a valid IANA timezone (e.g., UTC, America/New_York).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

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

  const interval_days =
    intervalOption && typeof intervalOption.value === 'number'
      ? intervalOption.value
      : 7;
  if (interval_days <= 0 || interval_days > 30) {
    await interaction.reply({
      content: 'Interval must be between 1 and 30 days.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const medication =
    medicationOption && typeof medicationOption.value === 'string'
      ? medicationOption.value
      : null;
  const dose_mg =
    doseOption && typeof doseOption.value === 'number'
      ? doseOption.value
      : null;

  const anchor = getAnchorDateTime(injection_day, time, timezone);
  if (!anchor) {
    await interaction.reply({
      content:
        'Could not compute the first reminder time. Please double-check the day, time, and timezone.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Use flags for deferReply
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const existing = await getGlobalSettings();

  const newSettings: Omit<GlobalSettings, 'id'> = {
    injection_day,
    injection_time: time,
    timezone,
    interval_days,
    start_time: anchor.toISO(),
    medication,
    dose_mg,
    test_start_time: existing?.test_start_time ?? null,
    test_interval_days: existing?.test_interval_days ?? null,
    test_timezone: existing?.test_timezone ?? timezone,
    last_run_at: existing?.last_run_at ?? null,
    test_last_run_at: existing?.test_last_run_at ?? null,
  };

  const success = await setGlobalSettings(newSettings);

  if (success) {
    logger.info(
      `Injection schedule updated by ${interaction.user.tag} to ${dayName} at ${time} (${timezone}), every ${interval_days} day(s).`,
    );
    try {
      await triggerReschedule();
      await interaction.editReply(
        `Injection schedule updated to ${dayOption.value} at ${time} (${timezone}), every ${interval_days} day(s). The scheduler has been updated.${medication ? ` Medication: ${medication}.` : ''}${
          dose_mg ? ` Default dose: ${dose_mg} mg.` : ''
        }`,
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
