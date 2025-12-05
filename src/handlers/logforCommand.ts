// src/handlers/logforCommand.ts
import type { CommandInteraction } from 'discord.js';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { createInjectionRecord, getGlobalSettings, recordAdminAction } from '../database';
import logger from '../logger';

export async function handleLogforCommand(interaction: CommandInteraction) {
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

  const doseOption = interaction.options.get('dose_mg');
  const medicationOption = interaction.options.get('medication');
  const performedAtOption = interaction.options.get('performed_at');
  const rawUnitsOption = interaction.options.get('raw_units');
  const doseMg =
    doseOption && typeof doseOption.value === 'number'
      ? doseOption.value
      : null;
  const medication =
    medicationOption && typeof medicationOption.value === 'string'
      ? medicationOption.value
      : null;
  const performedAt =
    performedAtOption && typeof performedAtOption.value === 'string'
      ? performedAtOption.value
      : null;
  const rawUnits =
    rawUnitsOption && typeof rawUnitsOption.value === 'number'
      ? rawUnitsOption.value
      : null;

  try {
    const defaults = await getGlobalSettings();
    const record = await createInjectionRecord(targetUser.id, {
      medication: medication ?? defaults?.medication ?? null,
      doseMg: doseMg ?? (defaults?.dose_mg ?? null),
      performedAt,
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
        details: `Dose ${record.dose_mg ?? 'n/a'} mg, units ${record.raw_units ?? 'n/a'}, performed_at ${record.performed_at ?? 'n/a'}`,
      });
      await interaction.editReply(
        `Injection recorded for ${targetUser.username}: **${record.leg} leg** on **${record.date}**${record.medication ? ` | Medication: ${record.medication}` : ''}${
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
