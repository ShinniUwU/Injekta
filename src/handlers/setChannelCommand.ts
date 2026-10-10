import type { ChatInputCommandInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { updateGuildSettings } from '../database';
import logger from '../logger';
import { guildIdOf } from '../utils/access';
import { hasAdminPermission } from '../utils/permissions';

export async function handleSetChannelCommand(
  interaction: ChatInputCommandInteraction,
) {
  if (!interaction.inGuild() || !hasAdminPermission(interaction)) {
    await interaction.reply({
      content: 'You need Administrator permissions to use this command.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const channel = interaction.options.getChannel('channel', true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = guildIdOf(interaction);
  const ok = await updateGuildSettings(guildId, { channel_id: channel.id });
  if (!ok) {
    await interaction.editReply('Could not save the channel.');
    return;
  }
  logger.info(`Reminder channel for ${guildId} set to ${channel.id}.`);
  await interaction.editReply(
    `Done. /injection must be used in <#${channel.id}>, and channel reminders are posted there. Make sure I can send messages in it.`,
  );
}
