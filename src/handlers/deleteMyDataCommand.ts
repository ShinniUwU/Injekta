import type { CommandInteraction, Message } from 'discord.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { deleteUserData } from '../database';
import logger from '../logger';
import { reschedulePersonal } from '../scheduler';
import { guildIdOf } from '../utils/access';
import { awaitConfirmation } from '../utils/awaitConfirm';

export async function handleDeleteMyDataCommand(
  interaction: CommandInteraction,
) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = guildIdOf(interaction);

  const confirmId = `confirm_delete_data_${interaction.id}`;
  const cancelId = `cancel_delete_data_${interaction.id}`;
  const embed = new EmbedBuilder()
    .setTitle('Delete all your data in this server?')
    .setDescription(
      'This removes your injection logs, your own schedule, and your privacy settings in this server. It cannot be undone. Your data in other servers is not touched.',
    )
    .setColor(0xe74c3c);
  const confirmButton = new ButtonBuilder()
    .setCustomId(confirmId)
    .setLabel('Yes, delete everything')
    .setStyle(ButtonStyle.Danger);
  const cancelButton = new ButtonBuilder()
    .setCustomId(cancelId)
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);

  await interaction.editReply({
    embeds: [embed],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        confirmButton,
        cancelButton,
      ),
    ],
  });
  const replyMessage = (await interaction.fetchReply()) as Message;

  const result = await awaitConfirmation({
    interaction,
    replyMessage,
    confirmId,
    cancelId,
    confirmButton,
    cancelButton,
    timeoutEmbed: new EmbedBuilder(embed.toJSON()).setDescription(
      'Timed out. Nothing was deleted.',
    ),
  });
  if (result === 'timeout') return;
  if (result === 'cancelled') {
    await interaction.editReply({
      content: 'Cancelled. Nothing was deleted.',
      embeds: [],
      components: [],
    });
    return;
  }

  const deleted = await deleteUserData(guildId, interaction.user.id);
  await reschedulePersonal(guildId, interaction.user.id);
  if (deleted) {
    logger.info(
      `User ${interaction.user.id} deleted their data in ${guildId}.`,
    );
  }
  await interaction.editReply({
    content: deleted
      ? `Deleted ${deleted.logs} log(s), your schedule, and your settings in this server.`
      : 'Something went wrong while deleting. Nothing was removed; please try again.',
    embeds: [],
    components: [],
  });
}
