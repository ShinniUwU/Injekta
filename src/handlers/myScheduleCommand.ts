import type { ChatInputCommandInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';
import {
  deleteUserSchedule,
  getUserSchedule,
  getUserSettings,
  setUserSchedule,
} from '../database';
import logger from '../logger';
import { reschedulePersonal } from '../scheduler';
import {
  formatDateTimeForDisplay,
  getNextFromAnchor,
  isValidTimeZone,
  parseUserDateTimeInput,
} from '../time';
import { guildIdOf } from '../utils/access';
import { getUserDefaults } from '../utils/defaults';
import { canDm, DM_CLOSED_HINT } from '../utils/dm';
import { getOptionNumber, getOptionString } from '../utils/options';

export async function handleMyScheduleCommand(
  interaction: ChatInputCommandInteraction,
) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = guildIdOf(interaction);
  const userId = interaction.user.id;
  const sub = interaction.options.getSubcommand();
  const locale = interaction.locale ?? 'en-US';

  if (sub === 'clear') {
    const removed = await deleteUserSchedule(guildId, userId);
    await reschedulePersonal(guildId, userId);
    await interaction.editReply(
      removed
        ? 'Your schedule is removed. You will not get injection reminders in this server.'
        : "You didn't have a schedule in this server.",
    );
    return;
  }

  if (sub === 'show') {
    const schedule = await getUserSchedule(guildId, userId);
    const privacy = await getUserSettings(guildId, userId);
    const remindLine = `Reminders go to: **${
      privacy.remind_via === 'dm' ? 'your DMs' : 'the server channel'
    }** (change with /privacy).`;
    if (!schedule) {
      await interaction.editReply(
        `You have no schedule in this server. Set one with \`/myschedule set\`.\n${remindLine}`,
      );
      return;
    }
    const tz = isValidTimeZone(schedule.timezone) ? schedule.timezone : 'UTC';
    const next = getNextFromAnchor(
      schedule.start_time,
      Number(schedule.interval_days),
      tz,
    );
    await interaction.editReply(
      [
        `Every **${schedule.interval_days}** day(s), timezone **${tz}**`,
        next
          ? `Next injection: **${formatDateTimeForDisplay(next, locale, tz)}**`
          : '',
        schedule.medication ? `Medication: **${schedule.medication}**` : '',
        schedule.dose_mg !== null ? `Dose: **${schedule.dose_mg} mg**` : '',
        remindLine,
      ]
        .filter(Boolean)
        .join('\n'),
    );
    return;
  }

  // sub === 'set'
  const nextInput = getOptionString(interaction, 'next') ?? '';
  const interval = getOptionNumber(interaction, 'every_days');
  const timezone =
    getOptionString(interaction, 'timezone') ??
    (await getUserDefaults(guildId, userId)).timezone;

  if (!isValidTimeZone(timezone)) {
    await interaction.editReply(
      'Invalid timezone. Use a name like `Europe/Berlin` or `America/New_York`.',
    );
    return;
  }
  if (!interval || interval <= 0) {
    await interaction.editReply('`every_days` must be at least 1.');
    return;
  }
  const next = parseUserDateTimeInput(nextInput, timezone);
  if (!next) {
    await interaction.editReply(
      `I couldn't read \`${nextInput}\` as a date. Try \`2026-10-17 09:00\`.`,
    );
    return;
  }

  const saved = await setUserSchedule({
    guild_id: guildId,
    user_id: userId,
    start_time: next.toISOString(),
    interval_days: interval,
    timezone,
    medication: getOptionString(interaction, 'medication'),
    dose_mg: getOptionNumber(interaction, 'dose_mg'),
  });
  if (!saved) {
    await interaction.editReply('Could not save your schedule. Try again.');
    return;
  }
  await reschedulePersonal(guildId, userId);
  logger.info(`User ${userId} set a personal schedule in ${guildId}.`);

  const privacy = await getUserSettings(guildId, userId);
  let reminderNote = 'Reminders will be posted in the server channel.';
  if (privacy.remind_via === 'dm') {
    const dmOk = await canDm(
      interaction.user,
      'Injekta will send your injection reminders here.',
    );
    reminderNote = dmOk
      ? 'Reminders will come by DM. I just sent you a test message.'
      : DM_CLOSED_HINT;
  }

  await interaction.editReply(
    `Saved. Next injection: **${formatDateTimeForDisplay(
      next,
      locale,
      timezone,
    )}**, then every **${interval}** day(s).\n${reminderNote}`,
  );
}
