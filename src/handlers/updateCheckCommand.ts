import type { ChatInputCommandInteraction, Client } from 'discord.js';
import { MessageFlags } from 'discord.js';
import {
  getUpdateStatus,
  getVersionNotifyEnabled,
  notifyIfOutdated,
  setVersionNotifyEnabled,
} from '../versionCheck';

const shortSha = (sha: string | null) =>
  sha && sha.length >= 7 ? sha.slice(0, 7) : 'unknown';

export async function handleUpdateCheckCommand(
  interaction: ChatInputCommandInteraction,
  client: Client,
) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'notify') {
    const mode = interaction.options.getString('mode', true);
    const enable = mode === 'on';
    setVersionNotifyEnabled(enable);
    await interaction.reply({
      content: `Automatic update alerts are now **${
        enable ? 'enabled' : 'disabled'
      }**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // sub === 'check'
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const status = getUpdateStatus();

  if (status.state === 'unknown') {
    await interaction.editReply(
      'Could not determine update status (git HEAD/remote unavailable).',
    );
    return;
  }

  if (status.state === 'up_to_date') {
    await interaction.editReply(
      `Running latest commit (${shortSha(status.local)}). Auto alerts are **${
        getVersionNotifyEnabled() ? 'enabled' : 'disabled'
      }**.`,
    );
    return;
  }

  await interaction.editReply(
    `Update available: remote **${shortSha(
      status.remote,
    )}** vs local **${shortSha(status.local)}**.\nAuto alerts are **${
      getVersionNotifyEnabled() ? 'enabled' : 'disabled'
    }**. Use \`git pull && bun install\` and restart the bot when ready.`,
  );

  // Optionally post to the channel immediately (but only once per remote)
  await notifyIfOutdated(client, { force: true });
}
