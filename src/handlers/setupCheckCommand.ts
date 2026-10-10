// src/handlers/setupCheckCommand.ts
import type { CommandInteraction } from 'discord.js';
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { getGuildSettings, pingDatabase } from '../database';
import { guildIdOf } from '../utils/access';
import { hasAdminPermission } from '../utils/permissions';

export async function handleSetupCheckCommand(interaction: CommandInteraction) {
  if (!interaction.inGuild() || !hasAdminPermission(interaction)) {
    await interaction.reply({
      content: 'Ask a server admin to run this setup check.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const dbOk = await pingDatabase();
  const settings = await getGuildSettings(guildIdOf(interaction));

  const channelSet = Boolean(settings?.channel_id);

  const embed = new EmbedBuilder()
    .setTitle('Setup check')
    .setDescription(
      'Quick scan to help you get Injekta ready without digging through docs.',
    )
    .setColor(dbOk && channelSet ? 0x2ecc71 : 0xf1c40f)
    .addFields(
      {
        name: 'Discord settings',
        value: channelSet
          ? `Reminder channel: <#${settings?.channel_id}>`
          : 'No channel yet. Run /setchannel to pick where /injection and channel reminders go. Without it, people can log anywhere and only DM reminders work.',
      },
      {
        name: 'Database',
        value: dbOk
          ? 'Connected ✅'
          : 'Cannot reach database. Check DATABASE_URL and that PostgreSQL is running.',
      },
      {
        name: 'Reminders',
        value:
          'Each member sets their own schedule with /myschedule set. There is no server-wide schedule.',
      },
      {
        name: 'Member commands',
        value:
          'Members can use /help for a walkthrough, /injection to log, /myschedule for their own reminders, and /privacy to choose DM or channel reminders. Logs are private by default; admins only see them if the member allows it.',
      },
      {
        name: 'Admin tips',
        value:
          'Use /sethormonetest for lab reminders if your community wants them.',
      },
    )
    .setFooter({
      text: 'You are almost done—thank you for supporting your community.',
    })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
