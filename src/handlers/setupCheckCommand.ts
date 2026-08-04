// src/handlers/setupCheckCommand.ts
import type { CommandInteraction } from 'discord.js';
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { config } from '../config';
import { getGlobalSettings, pingDatabase } from '../database';
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
  const settings = await getGlobalSettings();

  const channelSet = Boolean(config.designatedChannelId);
  const scheduleSet = Boolean(
    settings?.injection_day !== undefined && settings?.start_time,
  );

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
          ? `Designated channel: <#${config.designatedChannelId}>`
          : 'Set DESIGNATED_CHANNEL_ID to the channel you want for /injection logs.',
      },
      {
        name: 'Database',
        value: dbOk
          ? 'Connected ✅'
          : 'Cannot reach database. Check DATABASE_URL and that PostgreSQL is running.',
      },
      {
        name: 'Schedule',
        value: scheduleSet
          ? `Injection reminders configured (every ${settings?.interval_days} day(s), time ${settings?.injection_time} ${settings?.timezone}).`
          : 'No schedule yet. Run /setinjectionschedule to start reminders.',
      },
      {
        name: 'Member commands',
        value:
          'Members can use /help for a gentle walkthrough, /injection to log, /nextinjection for timing, and /checklogs to view their history.',
      },
      {
        name: 'Admin tips',
        value:
          'After DATABASE_URL and DESIGNATED_CHANNEL_ID are set, restart the bot so slash commands refresh. Use /sethormonetest for lab reminders if your community wants them.',
      },
    )
    .setFooter({
      text: 'You are almost done—thank you for supporting your community.',
    })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
