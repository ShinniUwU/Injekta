// src/scheduler.ts
import {
  Client,
  TextChannel,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageComponentInteraction,
} from 'discord.js';
import cron from 'node-cron';
import { createInjectionRecord, getGlobalSettings } from './supabase';
import logger from './logger';

// Helper: compute next injection Date based on global settings.
function computeNextInjection(settings: {
  injection_day: number;
  injection_time: string;
  timezone: string;
}): Date {
  const now = new Date();
  const [hourStr, minuteStr] = settings.injection_time.split(':');
  let nextInjection = new Date(now);
  nextInjection.setHours(parseInt(hourStr), parseInt(minuteStr), 0, 0);
  const currentDay = now.getDay();
  let daysUntil = (settings.injection_day - currentDay + 7) % 7;
  if (daysUntil === 0 && now >= nextInjection) daysUntil = 7;
  nextInjection.setDate(now.getDate() + daysUntil);
  return nextInjection;
}

export async function scheduleWeeklyPrompts(client: Client, channelId: string) {
  let settings = await getGlobalSettings();
  if (!settings) {
    logger.error(
      'Global settings not found. Using default: Saturday 09:00 UTC.',
    );
    settings = {
      id: 1,
      injection_day: 6,
      injection_time: '09:00',
      timezone: 'UTC',
    };
  }
  const nextInjection = computeNextInjection(settings);

  // Schedule injection prompt job.
  const promptCron = `${nextInjection.getMinutes()} ${nextInjection.getHours()} * * ${settings.injection_day}`;
  cron.schedule(promptCron, async () => {
    console.log('Injection prompt job triggered.');
    try {
      const channel = (await client.channels.fetch(channelId)) as TextChannel;
      if (!channel) {
        console.error('Designated channel not found for injection prompt.');
        return;
      }
      const promptEmbed = new EmbedBuilder()
        .setTitle('Injection Reminder')
        .setDescription(
          "It's injection time! Did you do your injection today?\nClick the **Confirm Injection** button below.",
        )
        .setColor(0x1abc9c)
        .setThumbnail(
          'https://cdn1.iconfinder.com/data/icons/medical-1-3/128/3-512.png',
        )
        .setTimestamp();

      const confirmButton = new ButtonBuilder()
        .setCustomId('weekly_confirm_injection')
        .setLabel('Confirm Injection')
        .setStyle(ButtonStyle.Success);

      const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        confirmButton,
      );

      const promptMessage = await channel.send({
        embeds: [promptEmbed],
        components: [actionRow],
      });

      const filter = (i: MessageComponentInteraction) =>
        i.customId === 'weekly_confirm_injection';
      const collector = promptMessage.createMessageComponentCollector({
        filter,
        max: 1,
        time: 60000,
      });

      collector.on('collect', async (i) => {
        try {
          await i.deferUpdate();
          console.log('Weekly injection confirmed.');
          // Use a dummy user id "weekly" for global prompt.
          const record = await createInjectionRecord('weekly');
          if (record) {
            await promptMessage.edit({
              embeds: [
                new EmbedBuilder()
                  .setTitle('Injection Recorded')
                  .setDescription(
                    `Injection recorded: **${record.leg} leg** on **${record.date}**.`,
                  )
                  .setColor(0x1abc9c)
                  .setTimestamp(),
              ],
              components: [],
            });
          } else {
            await promptMessage.edit({
              embeds: [
                new EmbedBuilder()
                  .setTitle('Error')
                  .setDescription('There was an error recording the injection.')
                  .setColor(0xe74c3c)
                  .setTimestamp(),
              ],
              components: [],
            });
          }
        } catch (error) {
          logger.error(
            'Error processing weekly injection confirmation:',
            error,
          );
        }
      });

      collector.on('end', async (collected) => {
        if (collected.size === 0) {
          await promptMessage.edit({
            embeds: [
              new EmbedBuilder()
                .setTitle('No Confirmation')
                .setDescription(
                  'No confirmation received. Injection not recorded.',
                )
                .setColor(0xe74c3c)
                .setTimestamp(),
            ],
            components: [],
          });
        }
      });
    } catch (error) {
      logger.error('Error in injection prompt job:', error);
    }
  });

  // Schedule a reminder 1 hour before injection time.
  const reminderTime = new Date(nextInjection.getTime() - 60 * 60 * 1000);
  const reminderCron = `${reminderTime.getMinutes()} ${reminderTime.getHours()} * * ${settings.injection_day}`;
  cron.schedule(reminderCron, async () => {
    console.log('Injection reminder job triggered.');
    try {
      const channel = (await client.channels.fetch(channelId)) as TextChannel;
      if (!channel) {
        console.error('Designated channel not found for injection reminder.');
        return;
      }
      const reminderEmbed = new EmbedBuilder()
        .setTitle('Injection Reminder - 1 Hour Left')
        .setDescription('Reminder: Your injection is due in 1 hour. Get ready!')
        .setColor(0xf1c40f)
        .setThumbnail('https://cdn-icons-png.flaticon.com/512/3075/3075977.png')
        .setTimestamp();

      await channel.send({ embeds: [reminderEmbed] });
    } catch (error) {
      logger.error('Error in injection reminder job:', error);
    }
  });
}
