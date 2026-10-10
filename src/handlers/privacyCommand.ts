import type { ChatInputCommandInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';
import type { RemindVia } from '../database';
import {
  getGuildSettings,
  getUserSettings,
  updateUserSettings,
} from '../database';
import { guildIdOf } from '../utils/access';
import { canDm, DM_CLOSED_HINT } from '../utils/dm';
import { getOptionString } from '../utils/options';

export async function handlePrivacyCommand(
  interaction: ChatInputCommandInteraction,
) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = guildIdOf(interaction);
  const userId = interaction.user.id;

  const adminAccess = getOptionString(interaction, 'admin_access');
  const reminders = getOptionString(
    interaction,
    'reminders',
  ) as RemindVia | null;

  const notes: string[] = [];
  let settings = await getUserSettings(guildId, userId);

  if (adminAccess || reminders) {
    if (
      reminders === 'channel' &&
      !(await getGuildSettings(guildId))?.channel_id
    ) {
      notes.push(
        'This server has no reminder channel yet, so channel reminders will not arrive until an admin runs /setchannel.',
      );
    }
    const updated = await updateUserSettings(guildId, userId, {
      share_with_admins:
        adminAccess === null ? undefined : adminAccess === 'allow',
      remind_via: reminders ?? undefined,
    });
    if (!updated) {
      await interaction.editReply('Could not save your privacy settings.');
      return;
    }
    settings = updated;
    if (reminders === 'dm') {
      const ok = await canDm(
        interaction.user,
        'Injekta will send your injection reminders here.',
      );
      notes.push(ok ? 'I sent you a test DM.' : DM_CLOSED_HINT);
    }
  }

  await interaction.editReply(
    [
      '**Your privacy in this server**',
      `Admin access to your logs: **${
        settings.share_with_admins ? 'allowed' : 'blocked'
      }**`,
      settings.share_with_admins
        ? '-# Admins can view your logs and stats, log for you, and fix or delete your entries. Their changes are recorded in an audit log.'
        : '-# Only you can see or change your logs. Admins get the same "private" reply whether you have logs or not.',
      `Reminders: **${
        settings.remind_via === 'dm' ? 'DM' : 'server channel'
      }**`,
      settings.remind_via === 'dm'
        ? '-# Nobody else sees your reminders.'
        : '-# Channel reminders mention you but never show your medication or dose.',
      '',
      'Stored about you here: your last 5 injection logs (date, leg, and optional medication, dose, units), your own schedule if you set one, and these settings. `/exportmydata` downloads it as JSON and `/deletemydata` removes all of it.',
      ...notes,
    ].join('\n'),
  );
}
