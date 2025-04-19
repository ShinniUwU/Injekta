// src/handlers/injectionCommand.ts
import type {
  Client,
  CommandInteraction,
  TextChannel,
  MessageComponentInteraction,
  InteractionEditReplyOptions,
} from 'discord.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags, // Import MessageFlags
} from 'discord.js';
import { createInjectionRecord } from '../database';
import { config } from '../config';
import logger from '../logger';

export async function handleInjectionCommand(
  interaction: CommandInteraction,
  client: Client,
) {
  if (interaction.channelId !== config.designatedChannelId) {
    await interaction.reply({
      content: `This command can only be used in the designated channel (<#${config.designatedChannelId}>).`,
      flags: MessageFlags.Ephemeral, // Use flags
    });
    return;
  }

  // Use flags for deferReply
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const interactionId = interaction.id;
  const confirmCustomId = `confirm_injection_${interactionId}`;
  const cancelCustomId = `cancel_injection_${interactionId}`;

  const confirmationEmbed = new EmbedBuilder()
    // ... (rest of embed setup)
    .setTitle('Injection Confirmation')
    .setDescription(
      'Press the button below to confirm you have completed your injection.',
    )
    .setColor(0x1abc9c)
    .setThumbnail(
      'https://cdn1.iconfinder.com/data/icons/medical-1-3/128/3-512.png',
    )
    .setFooter({
      text: `Requested by ${interaction.user.username}`,
      iconURL:
        interaction.user.displayAvatarURL() ?? client.user?.displayAvatarURL(),
    })
    .setTimestamp();

  const confirmButton = new ButtonBuilder()
    .setCustomId(confirmCustomId)
    .setLabel('Confirm Injection')
    .setStyle(ButtonStyle.Success);

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

  const filter = (i: MessageComponentInteraction) =>
    (i.customId === confirmCustomId || i.customId === cancelCustomId) &&
    i.user.id === interaction.user.id;

  try {
    const buttonInteraction = await interaction.channel?.awaitMessageComponent({
      filter,
      time: 60000,
    });

    if (!buttonInteraction) {
      throw new Error('Confirmation timed out.');
    }

    let replyOptions: InteractionEditReplyOptions = {};

    if (buttonInteraction.customId === confirmCustomId) {
      await buttonInteraction.deferUpdate();
      logger.info(`Injection confirmed by ${interaction.user.tag} via button.`);
      const record = await createInjectionRecord(interaction.user.id);

      if (record) {
        replyOptions = {
          content: `Injection recorded successfully: **${record.leg} leg** on **${record.date}**.`,
          embeds: [],
          components: [],
        };
      } else {
        replyOptions = {
          content:
            'There was an error recording the injection in the database.',
          embeds: [],
          components: [],
        };
      }
      await interaction.editReply(replyOptions);
    } else if (buttonInteraction.customId === cancelCustomId) {
      await buttonInteraction.deferUpdate();
      logger.info(`Injection cancelled by ${interaction.user.tag} via button.`);
      replyOptions = {
        content: 'Injection recording cancelled.',
        embeds: [],
        components: [],
      };
      await interaction.editReply(replyOptions);
    }
  } catch (error) {
    // ... (rest of catch block)
    logger.warn(
      `Confirmation timed out or error for ${interaction.user.tag}:`,
      error instanceof Error ? error.message : error,
    );
    const timedOutEmbed = new EmbedBuilder(confirmationEmbed.toJSON())
      .setDescription(
        'Confirmation timed out or failed. Injection not recorded.',
      )
      .setColor(0xe74c3c);

    confirmButton.setDisabled(true);
    cancelButton.setDisabled(true);
    const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      confirmButton,
      cancelButton,
    );

    const editOptions: InteractionEditReplyOptions = {
      embeds: [timedOutEmbed],
      components: [disabledRow],
    };
    await interaction
      .editReply(editOptions)
      .catch((editError) =>
        logger.error('Failed to edit reply after timeout/error:', editError),
      );
  }
}
