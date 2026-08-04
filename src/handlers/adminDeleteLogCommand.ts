// src/handlers/adminDeleteLogCommand.ts
import type { CommandInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { deleteLogById, recordAdminAction } from '../database';
import logger from '../logger';
import { formatTimestampForDisplay } from '../time';
import { hasAdminPermission } from '../utils/permissions';

export async function handleAdminDeleteLogCommand(
  interaction: CommandInteraction,
) {
  // Permission check
  if (!interaction.inGuild() || !hasAdminPermission(interaction)) {
    await interaction.reply({
      content: 'You need Administrator permissions to use this command.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Use .get('option_name') and access properties/value
  const targetUserOption = interaction.options.get('user', true);
  const logIdOption = interaction.options.get('log_id', true);

  // Extract values safely
  const targetUser = targetUserOption.user; // Get the User object
  const logId =
    typeof logIdOption.value === 'number' ? logIdOption.value : null; // Get the integer value

  // Validate extracted values
  if (!targetUser) {
    await interaction.reply({
      content: 'Could not resolve the user.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (logId === null || logId <= 0) {
    await interaction.reply({
      content: 'Invalid Log ID provided. It must be a positive number.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Call delete function
  const result = await deleteLogById(logId); // Admin command doesn't need userId check here

  if (result.success && result.deletedRecord) {
    logger.info(
      `Admin ${interaction.user.tag} deleted log ID ${logId} (belonging to ${result.deletedRecord.user_id}) for user ${targetUser.tag}.`,
    );
    await recordAdminAction({
      adminUserId: interaction.user.id,
      targetUserId: targetUser.id,
      action: 'admindeletelog',
      logId,
      details: `Deleted ${result.deletedRecord.leg} on ${
        result.deletedRecord.performed_at ?? result.deletedRecord.injection_date
      }`,
    });
    const medLabel = result.deletedRecord.medication
      ? ` | Medication: ${result.deletedRecord.medication}`
      : '';
    const doseLabel =
      result.deletedRecord.dose_mg !== null &&
      result.deletedRecord.dose_mg !== undefined
        ? ` | Dose: ${result.deletedRecord.dose_mg} mg`
        : '';
    await interaction.editReply(
      `Successfully deleted log entry #${logId} for user ${
        targetUser.username
      }. Details: ${
        result.deletedRecord.leg
      } leg on ${formatTimestampForDisplay(
        result.deletedRecord.performed_at ??
          result.deletedRecord.injection_date,
        interaction.locale ?? 'en-US',
      )}.${medLabel}${doseLabel}`,
    );
  } else {
    logger.warn(
      `Admin ${interaction.user.tag} failed to delete log ID ${logId} for user ${targetUser.tag}. Record might not exist.`,
    );
    await interaction.editReply(
      `Failed to delete log entry #${logId} for ${targetUser.username}. Please ensure the Log ID is correct.`,
    );
  }
}
