// src/handlers/helpCommand.ts
import type { CommandInteraction } from 'discord.js';
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { getGuildSettings } from '../database';
import { guildIdOf } from '../utils/access';

export async function handleHelpCommand(interaction: CommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const channelId = (await getGuildSettings(guildIdOf(interaction)))
    ?.channel_id;
  const channelHelp = channelId
    ? `Go to <#${channelId}> and use /injection`
    : 'Use /injection in any channel';

  const embed = new EmbedBuilder()
    .setTitle('Injekta quick help')
    .setDescription(
      'Friendly steps for anyone keeping up with HRT. Everything I send here is only visible to you.',
    )
    .setColor(0x2ecc71)
    .addFields(
      {
        name: 'Quick start',
        value: `1) ${channelHelp}.\n2) Check the leg and tap Confirm.\n3) Set your own reminders with /myschedule set.\nYou can leave dose/medication blank if you are unsure. I keep your last 5 logs tidy.`,
      },
      {
        name: 'If you are on estrogen',
        value:
          "Use the medication field for names like 'estradiol valerate' or 'estradiol enanthate' (progesterone fits here too). If your syringe only shows units, /convertunits turns that into mg so you do not have to do math.",
      },
      {
        name: 'If you are on testosterone',
        value:
          "Common entries: 'testosterone cypionate' or 'testosterone enanthate'. You can log units with /convertunits and let the bot calculate mg.",
      },
      {
        name: 'Fixing mistakes',
        value:
          'Use /checklogs to see what is saved, then pick a log to flip its leg, fix the date or dose, or delete it. Quick fix for a wrong leg: /setleg log_id:<ID> leg:<Left/Right>. Admins can only help with your logs if you allow it in /privacy.',
      },
      {
        name: 'Reminders',
        value:
          '/nextinjection tells you how long you have. Set your schedule with /myschedule set to get reminders. Reminders come by DM unless you pick the channel in /privacy. If you miss a shot, I will ping you every hour for up to 12 hours until you log it; use /snooze <hours> to push that back if you are busy.',
      },
      {
        name: 'What I store',
        value:
          'Your Discord ID, time of the log, which leg, and any optional medication/dose/units you choose to share, kept per server. Admins cannot see your logs unless you allow it. /privacy shows your settings, /exportmydata downloads your data, and /deletemydata erases everything. This is not medical advice.',
      },
    )
    .setFooter({ text: 'You have got this.' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
