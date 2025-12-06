// src/handlers/injectionCommand.ts
import type {
  Client,
  CommandInteraction,
  MessageComponentInteraction,
  Message,
  InteractionEditReplyOptions,
} from 'discord.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags, // Import MessageFlags
} from 'discord.js';
import { createInjectionRecord, getGlobalSettings } from '../database';
import { config } from '../config';
import logger from '../logger';
import { parseUserDateTimeInput } from '../time';

export async function handleInjectionCommand(
  interaction: CommandInteraction,
  client: Client,
) {
  if (!config.designatedChannelId) {
    await interaction.reply({
      content:
        'I need a home channel to keep injection logs tidy. Please ask an admin to set DESIGNATED_CHANNEL_ID (usually the HRT check-ins channel).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (interaction.channelId !== config.designatedChannelId) {
    await interaction.reply({
      content: `Please log injections in <#${config.designatedChannelId}> so reminders stay organized. If you cannot see it, ask a mod for access.`,
      flags: MessageFlags.Ephemeral, // Use flags
    });
    return;
  }

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

  // Use flags for deferReply
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const interactionId = interaction.id;
  const confirmCustomId = `confirm_injection_${interactionId}`;
  const cancelCustomId = `cancel_injection_${interactionId}`;

  const confirmationEmbed = new EmbedBuilder()
    // ... (rest of embed setup)
    .setTitle('Injection Confirmation')
    .setDescription(
      'Tap Confirm to save this injection. Replies stay private to you, and it is okay to leave dose/medication blank if you are unsure. I only keep your last 5 logs.',
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

  const replyMessage = (await interaction.fetchReply()) as Message;

  const filter = (i: MessageComponentInteraction) =>
    (i.customId === confirmCustomId || i.customId === cancelCustomId) &&
    i.user.id === interaction.user.id;

  try {
    const buttonInteraction = await replyMessage.awaitMessageComponent({
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
      const defaults = await getGlobalSettings();
      const tz = defaults?.timezone ?? 'UTC';
      const performedAtDate = performedAt
        ? parseUserDateTimeInput(performedAt, tz)
        : null;
      const record = await createInjectionRecord(interaction.user.id, {
        medication: medication ?? defaults?.medication ?? null,
        doseMg: doseMg ?? (defaults?.dose_mg ?? null),
        performedAt: performedAtDate ?? undefined,
        rawUnits,
      });

      if (record) {
        const medLabel = record.medication ? `\nMedication: **${record.medication}**` : '';
        const doseLabel =
          record.dose_mg !== null && record.dose_mg !== undefined
            ? `\nDose: **${record.dose_mg} mg**`
            : '';
        const unitLabel =
          record.raw_units !== null && record.raw_units !== undefined
            ? `\nRaw units: **${record.raw_units}**`
            : '';
        const performedLabel = record.performed_at
          ? `\nPerformed at: **${record.performed_at}**`
          : '';
        replyOptions = {
          content: `Injection recorded successfully: **${record.leg} leg** on **${record.date}**.${medLabel}${doseLabel}${unitLabel}${performedLabel}\nNice job taking care of yourself.`,
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
