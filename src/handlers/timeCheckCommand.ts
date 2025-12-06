import type { CommandInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { DateTime } from 'luxon';
import { getGlobalSettings } from '../database';

export async function handleTimeCheckCommand(interaction: CommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const settings = await getGlobalSettings();
  const tz = settings?.timezone && settings.timezone.trim() !== '' ? settings.timezone : 'UTC';

  const serverNow = DateTime.now();
  const configuredNow = serverNow.setZone(tz);

  const response = [
    `Server time: **${serverNow.toISO()}** (${serverNow.toFormat('ZZZZ')})`,
    `Configured timezone: **${tz}**`,
    `Configured time now: **${configuredNow.isValid ? configuredNow.toISO() : 'invalid timezone'}**`,
  ].join('\n');

  await interaction.editReply({ content: response });
}
