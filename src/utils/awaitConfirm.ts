import type { CommandInteraction, Message, MessageComponentInteraction } from 'discord.js';
import { ActionRowBuilder, ButtonBuilder, EmbedBuilder } from 'discord.js';
import logger from '../logger';

export async function awaitConfirmation(params: {
  interaction: CommandInteraction;
  replyMessage: Message;
  confirmId: string;
  cancelId: string;
  confirmButton: ButtonBuilder;
  cancelButton: ButtonBuilder;
  timeoutEmbed: EmbedBuilder;
  timeoutMs?: number;
}): Promise<'confirmed' | 'cancelled' | 'timeout'> {
  const {
    interaction,
    replyMessage,
    confirmId,
    cancelId,
    confirmButton,
    cancelButton,
    timeoutEmbed,
    timeoutMs = 60000,
  } = params;

  const filter = (i: MessageComponentInteraction) =>
    (i.customId === confirmId || i.customId === cancelId) &&
    i.user.id === interaction.user.id;

  try {
    const bi = await replyMessage.awaitMessageComponent({ filter, time: timeoutMs });
    await bi.deferUpdate();
    return bi.customId === confirmId ? 'confirmed' : 'cancelled';
  } catch (error) {
    logger.warn(
      `Button confirmation timed out or errored for ${interaction.user.tag}:`,
      error instanceof Error ? error.message : error,
    );
    confirmButton.setDisabled(true);
    cancelButton.setDisabled(true);
    const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      confirmButton,
      cancelButton,
    );
    await interaction
      .editReply({ embeds: [timeoutEmbed], components: [disabledRow] })
      .catch((e) => logger.error('Failed to edit reply after timeout:', e));
    return 'timeout';
  }
}
