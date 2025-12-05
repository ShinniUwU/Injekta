// src/handlers/setHormoneTestCommand.ts
import type { CommandInteraction } from 'discord.js';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import type { GlobalSettings } from '../database';
import { getGlobalSettings, setGlobalSettings } from '../database';
import { isValidTimeZone } from '../time';
import { DateTime } from 'luxon';
import logger from '../logger';

export async function handleSetHormoneTestCommand(
  interaction: CommandInteraction,
) {
  if (
    !interaction.inGuild() ||
    !interaction.member ||
    typeof interaction.member.permissions === 'string' ||
    !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
  ) {
    await interaction.reply({
      content: 'You need Administrator permissions to use this command.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const startDateOpt = interaction.options.get('start_date');
  const intervalOpt = interaction.options.get('interval_days');
  const timezoneOpt = interaction.options.get('timezone');

  const interval_days =
    intervalOpt && typeof intervalOpt.value === 'number'
      ? intervalOpt.value
      : 30;
  if (interval_days <= 0) {
    await interaction.reply({
      content: 'Interval must be at least 1 day.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const timezone =
    timezoneOpt && typeof timezoneOpt.value === 'string'
      ? timezoneOpt.value
      : undefined;
  const tzValid = timezone ? isValidTimeZone(timezone) : true;
  if (!tzValid) {
    await interaction.reply({
      content:
        'Invalid timezone. Please provide a valid IANA timezone (e.g., UTC, America/New_York).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let startIso: string | null = null;
  if (startDateOpt && typeof startDateOpt.value === 'string') {
    const parsed = DateTime.fromISO(startDateOpt.value, {
      zone: timezone ?? 'UTC',
    });
    if (!parsed.isValid) {
      await interaction.reply({
        content:
          'Invalid start_date format. Use YYYY-MM-DD or YYYY-MM-DDTHH:mm (ISO).',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    startIso = parsed.toISO();
  } else {
    startIso = DateTime.now().setZone(timezone ?? 'UTC').toISO();
  }

  if (!startIso) {
    await interaction.reply({
      content: 'Could not determine a valid start time for reminders.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const current = await getGlobalSettings();
  const newSettings: Omit<GlobalSettings, 'id'> = {
    injection_day: current?.injection_day ?? 0,
    injection_time: current?.injection_time ?? '09:00',
    timezone: current?.timezone ?? 'UTC',
    interval_days: current?.interval_days ?? 7,
    start_time: current?.start_time ?? startIso,
    medication: current?.medication ?? 'Injection',
    dose_mg: current?.dose_mg ?? null,
    test_start_time: startIso,
    test_interval_days: interval_days,
    test_timezone: timezone ?? current?.timezone ?? 'UTC',
    last_run_at: current?.last_run_at ?? null,
    test_last_run_at: current?.test_last_run_at ?? null,
  };

  const success = await setGlobalSettings(newSettings);
  if (success) {
    await interaction.editReply(
      `Hormone test reminder set. Start: ${startIso} (${timezone ?? 'UTC'}), interval: ${interval_days} day(s).`,
    );
    logger.info(
      `Hormone test reminder updated by ${interaction.user.tag}: start ${startIso}, interval ${interval_days}, tz ${timezone ?? 'UTC'}.`,
    );
  } else {
    await interaction.editReply(
      'Failed to update hormone test reminder in the database.',
    );
  }
}
