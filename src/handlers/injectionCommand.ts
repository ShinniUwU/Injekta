// src/handlers/injectionCommand.ts
import type {
  Client,
  CommandInteraction,
  Message,
  InteractionEditReplyOptions,
  MessageComponentInteraction,
} from 'discord.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import {
  createInjectionRecord,
  getGlobalSettings,
  getNextLeg,
  suggestNextLeg,
} from '../database';
import { config } from '../config';
import logger from '../logger';
import { parseUserDateTimeInput } from '../time';
import {
  getOptionLeg,
  getOptionNumber,
  getOptionString,
} from '../utils/options';

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

  const doseMg = getOptionNumber(interaction, 'dose_mg');
  const medication = getOptionString(interaction, 'medication');
  const performedAt = getOptionString(interaction, 'performed_at');
  const rawUnits = getOptionNumber(interaction, 'raw_units');
  const legOption = getOptionLeg(interaction);

  // Use flags for deferReply
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const defaults = await getGlobalSettings();
  const tz = defaults?.timezone ?? 'UTC';
  const performedAtDate = performedAt
    ? parseUserDateTimeInput(performedAt, tz)
    : null;
  if (performedAt && !performedAtDate) {
    await interaction.editReply(
      `I couldn't read \`${performedAt}\` as a date. Try \`2026-10-10 14:00\` or \`2026-10-10\`.`,
    );
    return;
  }
  let leg =
    legOption ??
    (await suggestNextLeg(interaction.user.id, performedAtDate ?? new Date()));

  const interactionId = interaction.id;
  const confirmCustomId = `confirm_injection_${interactionId}`;
  const cancelCustomId = `cancel_injection_${interactionId}`;
  const switchLegCustomId = `switch_leg_injection_${interactionId}`;

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
  const setLegField = () =>
    confirmationEmbed.setFields({
      name: 'Leg',
      value: `**${leg}**${
        legOption ? '' : ' (picked by alternating from your last log)'
      }`,
    });
  setLegField();

  const confirmButton = new ButtonBuilder()
    .setCustomId(confirmCustomId)
    .setLabel('Confirm Injection')
    .setStyle(ButtonStyle.Success);

  const cancelButton = new ButtonBuilder()
    .setCustomId(cancelCustomId)
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);

  const switchLegButton = new ButtonBuilder()
    .setCustomId(switchLegCustomId)
    .setStyle(ButtonStyle.Primary);
  const buildRow = () =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      confirmButton,
      switchLegButton.setLabel(`Switch to ${getNextLeg(leg)}`),
      cancelButton,
    );
  const actionRow = buildRow();

  await interaction.editReply({
    embeds: [confirmationEmbed],
    components: [actionRow],
  });

  const replyMessage = (await interaction.fetchReply()) as Message;

  const timeoutEmbed = new EmbedBuilder(confirmationEmbed.toJSON())
    .setDescription('Confirmation timed out or failed. Injection not recorded.')
    .setColor(0xe74c3c);

  const filter = (i: MessageComponentInteraction) =>
    [confirmCustomId, cancelCustomId, switchLegCustomId].includes(i.customId) &&
    i.user.id === interaction.user.id;

  let result: 'confirmed' | 'cancelled' | 'timeout' = 'timeout';
  while (result === 'timeout') {
    let clicked: MessageComponentInteraction;
    try {
      clicked = await replyMessage.awaitMessageComponent({
        filter,
        time: 60000,
      });
    } catch {
      [confirmButton, switchLegButton, cancelButton].forEach((b) =>
        b.setDisabled(true),
      );
      await interaction
        .editReply({ embeds: [timeoutEmbed], components: [buildRow()] })
        .catch((e) => logger.error('Failed to edit reply after timeout:', e));
      return;
    }
    if (clicked.customId === switchLegCustomId) {
      leg = getNextLeg(leg);
      setLegField();
      await clicked.update({
        embeds: [confirmationEmbed],
        components: [buildRow()],
      });
      continue;
    }
    await clicked.deferUpdate();
    result = clicked.customId === confirmCustomId ? 'confirmed' : 'cancelled';
  }

  let replyOptions: InteractionEditReplyOptions = {};

  if (result === 'confirmed') {
    logger.info(`Injection confirmed by ${interaction.user.tag} via button.`);
    const record = await createInjectionRecord(interaction.user.id, {
      medication: medication ?? defaults?.medication ?? null,
      doseMg: doseMg ?? defaults?.dose_mg ?? null,
      performedAt: performedAtDate ?? undefined,
      rawUnits,
      leg,
    });

    if (record) {
      const medLabel = record.medication
        ? `\nMedication: **${record.medication}**`
        : '';
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
        content: 'There was an error recording the injection in the database.',
        embeds: [],
        components: [],
      };
    }
  } else {
    logger.info(`Injection cancelled by ${interaction.user.tag} via button.`);
    replyOptions = {
      content: 'Injection recording cancelled.',
      embeds: [],
      components: [],
    };
  }

  await interaction.editReply(replyOptions);
}
