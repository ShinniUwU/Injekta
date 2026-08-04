// src/handlers/helpCommand.ts
import type { CommandInteraction } from 'discord.js';
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { config } from '../config';

export async function handleHelpCommand(interaction: CommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const channelHelp = config.designatedChannelId
    ? `<#${config.designatedChannelId}>`
    : 'the injection channel (ask a mod to set DESIGNATED_CHANNEL_ID)';

  const embed = new EmbedBuilder()
    .setTitle('Injekta quick help')
    .setDescription(
      'Friendly steps for anyone keeping up with HRT. Everything I send here is only visible to you.',
    )
    .setColor(0x2ecc71)
    .addFields(
      {
        name: 'Quick start',
        value: `1) Go to ${channelHelp}.\n2) Use /injection.\n3) Tap Confirm when you are done.\nYou can leave dose/medication blank if you are unsure. I keep your last 5 logs tidy.`,
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
          'Use /deletemylog to undo your latest entry (or a specific one), and /checklogs to see what is saved. Admins can use /logfor or /admindeletelog to help.',
      },
      {
        name: 'Reminders',
        value:
          '/nextinjection tells you how long you have. Admins can set /setinjectionschedule for shot reminders and /sethormonetest for lab check-ins. If you miss a shot, I will ping you every hour for up to 12 hours until you log it; use /snooze <hours> to push that back if you are busy.',
      },
      {
        name: 'What I store',
        value:
          'Your Discord ID, time of the log, which leg, and any optional medication/dose/units you choose to share. Nothing is posted publicly and this is not medical advice.',
      },
    )
    .setFooter({ text: 'You have got this.' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
