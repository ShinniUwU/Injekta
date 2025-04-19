// src/scheduler.ts
import type {
  Client,
  TextChannel,
  MessageComponentInteraction,
} from 'discord.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import * as cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import type { GlobalSettings } from './database';
import { getGlobalSettings } from './database'; // Ensure this is correctly imported
import logger from './logger';
import { config } from './config';

let promptTask: ScheduledTask | null = null;
let reminderTask: ScheduledTask | null = null;
let currentClient: Client | null = null;

// Helper: compute next injection Date based on global settings.
function computeNextInjectionDate(settings: GlobalSettings): Date | null {
  try {
    if (
      !settings ||
      typeof settings.injection_day !== 'number' ||
      !settings.injection_time
    ) {
      logger.error(
        'Invalid settings provided to computeNextInjectionDate:',
        settings,
      );
      return null;
    }
    const now = new Date();
    const [hourStr, minuteStr] = settings.injection_time.split(':');
    const hour = parseInt(hourStr, 10);
    const minute = parseInt(minuteStr, 10);
    if (
      isNaN(hour) ||
      isNaN(minute) ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59
    ) {
      logger.error(
        `Invalid time format in settings: ${settings.injection_time}`,
      );
      return null;
    }
    let nextInjection = new Date();
    nextInjection.setHours(hour, minute, 0, 0);
    const currentDay = now.getDay();
    let daysUntil = (settings.injection_day - currentDay + 7) % 7;
    if (daysUntil === 0 && now.getTime() >= nextInjection.getTime()) {
      daysUntil = 7;
    }
    nextInjection.setDate(now.getDate() + daysUntil);
    return nextInjection;
  } catch (error) {
    logger.error('Error computing next injection date:', error);
    return null;
  }
} // Closing brace for computeNextInjectionDate

// Renamed internal function slightly to avoid potential conflict with export name if any
async function internalScheduleJobs(client: Client, settings: GlobalSettings) {
  if (promptTask) {
    promptTask.stop();
    promptTask = null;
    logger.info('Stopped existing prompt task.');
  }
  if (reminderTask) {
    reminderTask.stop();
    reminderTask = null;
    logger.info('Stopped existing reminder task.');
  }

  const channelId = config.designatedChannelId;
  if (!channelId) {
    logger.error(
      'DESIGNATED_CHANNEL_ID is not configured. Cannot schedule prompts/reminders.',
    );
    return;
  }

  const nextInjectionDate = computeNextInjectionDate(settings);
  if (!nextInjectionDate) {
    logger.error(
      'Could not compute next injection date from settings. Aborting schedule.',
    );
    return;
  }

  const [hour, minute] = settings.injection_time.split(':');
  const cronTimezone = settings.timezone || 'UTC';

  const promptCron = `${minute} ${hour} * * ${settings.injection_day}`;
  logger.info(
    `Scheduling prompt job with cron: "${promptCron}" in timezone "${cronTimezone}"`,
  );

  promptTask = cron.schedule(
    promptCron,
    async () => {
      // Opening brace for async callback (matches related info start point)
      logger.info(
        `Injection prompt job triggered for ${settings.injection_day} at ${settings.injection_time} ${cronTimezone}.`,
      );
      try {
        // Opening brace for try block
        const channel = (await client.channels.fetch(channelId).catch((err) => {
          logger.error(`Failed to fetch channel ${channelId} for prompt:`, err);
          return null;
        })) as TextChannel | null;

        if (!channel) {
          logger.error(
            `Designated channel ${channelId} not found or accessible for injection prompt.`,
          );
          return; // Exit if channel not found
        }

        const promptEmbed = new EmbedBuilder()
          .setTitle('Injection Reminder')
          .setDescription(
            "It's injection time! Please log your injection using the `/injection` command.",
          )
          .setColor(0x1abc9c)
          .setThumbnail(
            'https://cdn1.iconfinder.com/data/icons/medical-1-3/128/3-512.png',
          )
          .setTimestamp();

        await channel.send({ embeds: [promptEmbed] }); // Line 87 area
        logger.info(`Sent injection prompt to channel ${channelId}.`); // Added for clarity
      } catch (error) {
        // Closing brace for try, opening for catch
        logger.error('Error in injection prompt job execution:', error);
      } // Closing brace for catch
    },
    {
      // Closing brace for async callback, opening for options object
      scheduled: true,
      timezone: cronTimezone,
    },
  ); // Closing brace and parenthesis for cron.schedule call
  logger.info(`Prompt task scheduled successfully.`);

  // --- Schedule Reminder Job (1 hour before) ---
  let reminderTime = new Date(nextInjectionDate.getTime());
  reminderTime.setHours(reminderTime.getHours() - 1);
  const reminderMinute = reminderTime.getMinutes();
  const reminderHour = reminderTime.getHours();
  const reminderDayOfWeek = reminderTime.getDay();
  const reminderCron = `${reminderMinute} ${reminderHour} * * ${reminderDayOfWeek}`;
  logger.info(
    `Scheduling reminder job with cron: "${reminderCron}" in timezone "${cronTimezone}"`,
  );

  reminderTask = cron.schedule(
    reminderCron,
    async () => {
      logger.info(
        `Injection reminder job triggered for 1 hour before schedule.`,
      );
      try {
        const channel = (await client.channels.fetch(channelId).catch((err) => {
          logger.error(
            `Failed to fetch channel ${channelId} for reminder:`,
            err,
          );
          return null;
        })) as TextChannel | null;

        if (!channel) {
          logger.error(
            `Designated channel ${channelId} not found or accessible for injection reminder.`,
          );
          return;
        }

        const reminderEmbed = new EmbedBuilder()
          .setTitle('Injection Reminder - 1 Hour Left')
          .setDescription(
            'Reminder: Your injection is scheduled in approximately 1 hour. Get ready!',
          )
          .setColor(0xf1c40f)
          .setThumbnail(
            'https://cdn-icons-png.flaticon.com/512/3075/3075977.png',
          )
          .setTimestamp();

        await channel.send({ embeds: [reminderEmbed] });
        logger.info(`Sent injection reminder to channel ${channelId}.`);
      } catch (error) {
        logger.error('Error in injection reminder job execution:', error);
      }
    },
    {
      scheduled: true,
      timezone: cronTimezone,
    },
  );
  logger.info(`Reminder task scheduled successfully.`);
} // Closing brace for internalScheduleJobs

// EXPORTED function called initially and when settings change
export async function initializeScheduler(client: Client) {
  logger.info('Initializing scheduler...');
  currentClient = client;
  const settings = await getGlobalSettings();
  if (!settings) {
    logger.error(
      'Failed to get global settings during initialization. Scheduler not started.',
    );
    return;
  }
  logger.info(
    `Workspaceed initial settings: Day ${settings.injection_day}, Time ${settings.injection_time}, TZ ${settings.timezone}`,
  );
  await internalScheduleJobs(client, settings); // Call internal function
} // Closing brace for initializeScheduler

// EXPORTED function to be called by setInjectionSchedule command handler
export async function rescheduleJobs() {
  if (!currentClient) {
    logger.error('Cannot reschedule jobs: Client instance not available.');
    return;
  }
  logger.info('Rescheduling jobs due to settings update...');
  const settings = await getGlobalSettings();
  if (!settings) {
    logger.error(
      'Failed to get global settings for rescheduling. Keeping old schedule.',
    );
    return;
  }
  logger.info(
    `Workspaceed updated settings: Day ${settings.injection_day}, Time ${settings.injection_time}, TZ ${settings.timezone}`,
  );
  await internalScheduleJobs(currentClient, settings); // Call internal function
  logger.info('Jobs rescheduled successfully.');
} // Closing brace for rescheduleJobs
