// src/handlers/logforCommand.ts
import type { CommandInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';
import {
  createInjectionRecord,
  getGlobalSettings,
  recordAdminAction,
} from '../database';
import logger from '../logger';
import { parseUserDateTimeInput } from '../time';
import { hasAdminPermission } from '../utils/permissions';
import { getOptionNumber, getOptionString } from '../utils/options';

export async function handleLogforCommand(interaction: CommandInteraction) {
  if (!interaction.inGuild() || !hasAdminPermission(interaction)) {
    await interaction.reply({
      content: 'You need Administrator permissions to use this command.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Get the user option data slightly differently
  const targetUserOption = interaction.options.get('user', true); // Get the raw option, true makes it required
  const targetUser = targetUserOption?.user; // Access the user property

  // Check if the user was successfully retrieved
  if (!targetUser) {
    logger.error(
      `Could not resolve user option for /logfor command by ${interaction.user.tag}. Option data:`,
      targetUserOption,
    );
    await interaction.reply({
      content: 'Could not find the specified user.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (targetUser.bot) {
    await interaction.reply({
      content: 'You cannot log injections for bots.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const doseMg = getOptionNumber(interaction, 'dose_mg');
  const medication = getOptionString(interaction, 'medication');
  const performedAt = getOptionString(interaction, 'performed_at');
  const rawUnits = getOptionNumber(interaction, 'raw_units');

  try {
    const defaults = await getGlobalSettings();
    const tz = defaults?.timezone ?? 'UTC';
    const performedAtDate = performedAt
      ? parseUserDateTimeInput(performedAt, tz)
      : null;
    const record = await createInjectionRecord(targetUser.id, {
      medication: medication ?? defaults?.medication ?? null,
      doseMg: doseMg ?? defaults?.dose_mg ?? null,
      performedAt: performedAtDate ?? undefined,
      rawUnits,
      adminUserId: interaction.user.id,
    });

    if (record) {
      logger.info(
        `Admin ${interaction.user.tag} logged injection for ${targetUser.tag}: ${record.leg} leg on ${record.date}.`,
      );
      await recordAdminAction({
        adminUserId: interaction.user.id,
        targetUserId: targetUser.id,
        action: 'logfor',
        logId: record.id,
        details: `Dose ${record.dose_mg ?? 'n/a'} mg, units ${
          record.raw_units ?? 'n/a'
        }, performed_at ${record.performed_at ?? 'n/a'}`,
      });
      await interaction.editReply(
        `Injection recorded for ${targetUser.username}: **${
          record.leg
        } leg** on **${record.date}**${
          record.medication ? ` | Medication: ${record.medication}` : ''
        }${
          record.dose_mg !== null && record.dose_mg !== undefined
            ? ` | Dose: ${record.dose_mg} mg`
            : ''
        }.`,
      );
    } else {
      logger.error(
        `Admin ${interaction.user.tag} failed to log injection for ${targetUser.tag}.`,
      );
      await interaction.editReply(
        `There was an error recording the injection for ${targetUser.username}.`,
      );
    }
  } catch (error) {
    logger.error(
      `Error during /logfor command for ${targetUser.tag} triggered by ${interaction.user.tag}:`,
      error,
    );
    await interaction.editReply(
      `An unexpected error occurred while logging the injection for ${targetUser.username}.`,
    );
  }
}
