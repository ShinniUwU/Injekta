// src/handlers/deleteMyLogCommand.ts
import type { CommandInteraction, Message } from 'discord.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type InteractionEditReplyOptions,
  MessageFlags,
} from 'discord.js';
import { deleteLogById, deleteLatestLogForUser } from '../database';
import type { InjectionRecord } from '../database';
import { awaitConfirmation } from '../utils/awaitConfirm';
import logger from '../logger';
import { formatTimestampForDisplay } from '../time';
import { getOptionNumber } from '../utils/options';

export async function handleDeleteMyLogCommand(
  interaction: CommandInteraction,
) {
  const logIdToDelete = getOptionNumber(interaction, 'log_id');

  // Validate if ID was provided but invalid
  if (logIdToDelete !== null && logIdToDelete <= 0) {
    await interaction.reply({
      content: 'Invalid Log ID provided. It must be a positive number.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const interactionId = interaction.id;
  const confirmCustomId = `confirm_delete_log_${interactionId}`;
  const cancelCustomId = `cancel_delete_log_${interactionId}`;
  let targetLogDesc = '';
  let operationType: 'latest' | 'specific' = 'latest';

  // Determine description and operation type based on validated logIdToDelete
  if (logIdToDelete !== null) {
    targetLogDesc = `log entry with ID **#${logIdToDelete}**`;
    operationType = 'specific';
  } else {
    targetLogDesc = 'your **most recent** log entry';
    operationType = 'latest';
  }

  // --- Rest of the handler logic (confirmation embed, buttons, awaitMessageComponent, try/catch block) remains the same as the previous version ---
  // Ensure the logic inside the try block correctly uses logIdToDelete (if operationType === 'specific')
  // or interaction.user.id (for deleteLatestLogForUser)
  const confirmationEmbed = new EmbedBuilder()
    .setTitle('Confirm Deletion')
    .setDescription(
      `Are you sure you want to delete ${targetLogDesc}? This action cannot be undone.`,
    )
    .setColor(0xe74c3c)
    .setFooter({ text: `Requested by ${interaction.user.username}` })
    .setTimestamp();

  const confirmButton = new ButtonBuilder()
    .setCustomId(confirmCustomId)
    .setLabel('Yes, Delete It')
    .setStyle(ButtonStyle.Danger);

  const cancelButton = new ButtonBuilder()
    .setCustomId(cancelCustomId)
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    confirmButton,
    cancelButton,
  );

  await interaction.editReply({
    embeds: [confirmationEmbed],
    components: [actionRow],
  });

  const replyMessage = (await interaction.fetchReply()) as Message;

  const timeoutEmbed = new EmbedBuilder(confirmationEmbed.toJSON())
    .setDescription('Confirmation timed out or failed. Log entry not deleted.')
    .setColor(0x95a5a6);

  const confirmed = await awaitConfirmation({
    interaction,
    replyMessage,
    confirmId: confirmCustomId,
    cancelId: cancelCustomId,
    confirmButton,
    cancelButton,
    timeoutEmbed,
  });

  if (confirmed === 'timeout') return;

  let replyOptions: InteractionEditReplyOptions = {};

  if (confirmed === 'confirmed') {
    logger.info(
      `${interaction.user.tag} confirmed deletion for ${targetLogDesc}.`,
    );

    let result: { success: boolean; deletedRecord?: InjectionRecord } = {
      success: false,
    };
    if (operationType === 'specific' && logIdToDelete) {
      result = await deleteLogById(logIdToDelete, interaction.user.id);
    } else if (operationType === 'latest') {
      result = await deleteLatestLogForUser(interaction.user.id);
    }

    if (result.success && result.deletedRecord) {
      const deletedInfo = result.deletedRecord;
      const medLabel = deletedInfo.medication
        ? ` | Medication: ${deletedInfo.medication}`
        : '';
      const doseLabel =
        deletedInfo.dose_mg !== null && deletedInfo.dose_mg !== undefined
          ? ` | Dose: ${deletedInfo.dose_mg} mg`
          : '';
      const unitLabel =
        deletedInfo.raw_units !== null && deletedInfo.raw_units !== undefined
          ? ` | Units: ${deletedInfo.raw_units}`
          : '';
      replyOptions = {
        content: `Successfully deleted log entry #${deletedInfo.id} (${
          deletedInfo.leg
        } leg on ${formatTimestampForDisplay(
          deletedInfo.performed_at ?? deletedInfo.injection_date,
          interaction.locale ?? 'en-US',
        )}${medLabel}${doseLabel}${unitLabel}).`,
        embeds: [],
        components: [],
      };
    } else if (
      result.success &&
      !result.deletedRecord &&
      operationType === 'latest'
    ) {
      replyOptions = {
        content: 'Successfully deleted your latest log entry.',
        embeds: [],
        components: [],
      };
    } else if (!result.success && operationType === 'specific') {
      replyOptions = {
        content: `Failed to delete log entry #${logIdToDelete}. It might not exist or doesn't belong to you.`,
        embeds: [],
        components: [],
      };
    } else {
      replyOptions = {
        content:
          'Failed to delete the log entry. No log might exist or an error occurred.',
        embeds: [],
        components: [],
      };
    }
  } else {
    logger.info(
      `${interaction.user.tag} cancelled deletion for ${targetLogDesc}.`,
    );
    replyOptions = {
      content: 'Deletion cancelled.',
      embeds: [],
      components: [],
    };
  }

  await interaction.editReply(replyOptions);
}
