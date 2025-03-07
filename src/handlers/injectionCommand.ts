// src/handlers/injectionCommand.ts
import {
  Client,
  TextChannel,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageComponentInteraction,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { createInjectionRecord } from '../supabase';

export async function handleInjectionCommand(interaction: any, client: Client) {
  if (interaction.channelId !== '1312689693732896869') {
    await interaction.reply({
      content: 'This command can only be used in the designated channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const confirmationEmbed = new EmbedBuilder()
    .setTitle('Injection Confirmation')
    .setDescription(
      'Did you do your injection today?\nClick the **Confirm Injection** button below.',
    )
    .setColor(0x1abc9c)
    .setThumbnail(
      'https://cdn1.iconfinder.com/data/icons/medical-1-3/128/3-512.png',
    )
    .setFooter({
      text: 'Your Injection Reminder Bot',
      iconURL: client.user?.displayAvatarURL(),
    })
    .setTimestamp();

  const confirmButton = new ButtonBuilder()
    .setCustomId('confirm_injection')
    .setLabel('Confirm Injection')
    .setStyle(ButtonStyle.Success);

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    confirmButton,
  );

  const channel = interaction.channel as TextChannel;
  const confirmationMessage = await channel.send({
    embeds: [confirmationEmbed],
    components: [actionRow],
  });

  const filter = (i: MessageComponentInteraction) =>
    i.customId === 'confirm_injection' && i.user.id === interaction.user.id;
  const collector = confirmationMessage.createMessageComponentCollector({
    filter,
    max: 1,
    time: 60000,
  });

  collector.on('collect', async (i) => {
    try {
      await i.deferUpdate();
      const record = await createInjectionRecord(interaction.user.id);
      if (record) {
        await interaction.editReply(
          `Injection recorded: **${record.leg} leg** on **${record.date}**.`,
        );
      } else {
        await interaction.editReply(
          'There was an error recording the injection.',
        );
      }
    } catch (error) {
      console.error('Error processing button interaction:', error);
      await interaction.editReply(
        'There was an error processing your confirmation.',
      );
    }
  });

  collector.on('end', async (collected) => {
    if (collected.size === 0) {
      await interaction.editReply(
        'No confirmation received within 60 seconds. Injection not recorded.',
      );
    }
  });
}
