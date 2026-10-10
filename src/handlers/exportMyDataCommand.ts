import type { CommandInteraction } from 'discord.js';
import { AttachmentBuilder, MessageFlags } from 'discord.js';
import { exportUserData } from '../database';
import logger from '../logger';
import { guildIdOf } from '../utils/access';

const COOLDOWN_MS = 60 * 1000;
const lastExport = new Map<string, number>();

// Sends the caller a JSON file of their own data in this server. There is no
// user option on purpose: nobody, admins included, can export someone else.
export async function handleExportMyDataCommand(
  interaction: CommandInteraction,
) {
  const guildId = guildIdOf(interaction);
  const userId = interaction.user.id;
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const last = lastExport.get(key);
  if (last && now - last < COOLDOWN_MS) {
    await interaction.reply({
      content: `You just exported. Try again in ${Math.ceil(
        (COOLDOWN_MS - (now - last)) / 1000,
      )} seconds.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  lastExport.set(key, now);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const data = await exportUserData(guildId, userId);
    const payload = {
      format: 'injekta-export',
      version: 1,
      exported_at: new Date().toISOString(),
      server_id: guildId,
      user_id: userId,
      ...data,
    };
    const file = new AttachmentBuilder(
      Buffer.from(JSON.stringify(payload, null, 2), 'utf-8'),
      { name: 'injekta-export.json' },
    );
    // Log that it happened, never what was in it
    logger.info(`User ${userId} exported their data in ${guildId}.`);
    await interaction.editReply({
      content: `Here is everything Injekta stores about you in this server (${data.logs.length} log(s)). Only you can see this message. The file contains health info, so be careful where you share it.`,
      files: [file],
    });
  } catch (error) {
    lastExport.delete(key);
    logger.error('Failed to export user data', { error });
    await interaction.editReply('Could not create your export. Try again.');
  }
}
