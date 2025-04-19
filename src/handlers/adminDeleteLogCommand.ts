// src/handlers/adminDeleteLogCommand.ts
import type { CommandInteraction, User } from 'discord.js';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { deleteLogById } from '../database';
import logger from '../logger';

export async function handleAdminDeleteLogCommand(
  interaction: CommandInteraction,
) {
  // Permission check
  if (
    !interaction.inGuild() ||
    !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
  ) {
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
    await interaction.editReply(
      `Successfully deleted log entry #${logId} for user ${targetUser.username}. Details: ${result.deletedRecord.leg} leg on ${result.deletedRecord.injection_date}.`,
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
