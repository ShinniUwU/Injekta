// src/scheduler.ts
import type { Client, TextChannel } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import type { GlobalSettings } from './database';
import {
  getGlobalSettings,
  updateSchedulerRunTimes,
  getLastRecord,
} from './database'; // Ensure this is correctly imported
import logger from './logger';
import { config } from './config';
import {
  getNextInjectionDateTime,
  isValidTimeZone,
  getAnchorDateTime,
  getNextFromAnchor,
} from './time';
import { DateTime } from 'luxon';

const MAX_TIMEOUT = 2 ** 31 - 1;

let promptTimeout: NodeJS.Timeout | null = null;
let reminderTimeout: NodeJS.Timeout | null = null;
let testReminderTimeout: NodeJS.Timeout | null = null;
let currentClient: Client | null = null;
let currentSettings: GlobalSettings | null = null;

// Renamed internal function slightly to avoid potential conflict with export name if any
function clearScheduled() {
  if (promptTimeout) {
    clearTimeout(promptTimeout);
    promptTimeout = null;
    logger.info('Cleared existing prompt timeout.');
  }
  if (reminderTimeout) {
    clearTimeout(reminderTimeout);
    reminderTimeout = null;
    logger.info('Cleared existing reminder timeout.');
  }
  if (testReminderTimeout) {
    clearTimeout(testReminderTimeout);
    testReminderTimeout = null;
    logger.info('Cleared existing hormone test reminder timeout.');
  }
}

function scheduleTimeout(
  target: DateTime,
  callback: () => Promise<void>,
  label: string,
): NodeJS.Timeout {
  let timeout: NodeJS.Timeout;
  const scheduleChunk = () => {
    const now = DateTime.now().setZone(target.zoneName ?? undefined);
    const delayMs = target.diff(now, 'milliseconds').milliseconds;
    if (delayMs <= 0) {
      logger.warn(
        `${label} time is in the past; executing immediately. target=${target.toISO()}`,
      );
      void callback();
      return;
    }
    if (delayMs > MAX_TIMEOUT) {
      logger.info(
        `${label} is more than ${Math.round(
          MAX_TIMEOUT / (1000 * 60 * 60 * 24),
        )} days away; scheduling intermediate wake-up.`,
      );
      timeout = setTimeout(scheduleChunk, MAX_TIMEOUT);
    } else {
      timeout = setTimeout(() => {
        void callback();
      }, delayMs);
    }
  };
  scheduleChunk();
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return timeout!;
}

async function internalScheduleJobs(client: Client, settings: GlobalSettings) {
  clearScheduled();
  currentSettings = settings;

  const channelId = config.designatedChannelId;
  if (!channelId) {
    logger.error(
      'DESIGNATED_CHANNEL_ID is not configured. Cannot schedule prompts/reminders.',
    );
    return;
  }

  if (!settings.start_time) {
    const anchor = getAnchorDateTime(
      settings.injection_day,
      settings.injection_time,
      settings.timezone,
    );
    if (anchor) {
      const iso = anchor.toISO();
      if (iso) {
        settings.start_time = iso;
        logger.warn('start_time missing in settings; using computed anchor.');
      } else {
        logger.error('Failed to derive ISO string for start_time.');
        return;
      }
    } else {
      logger.error(
        'start_time missing and could not compute anchor. Aborting scheduling.',
      );
      return;
    }
  }

  const nextInjectionDate = getNextInjectionDateTime(settings);
  if (!nextInjectionDate) {
    logger.error(
      'Could not compute next injection date from settings. Aborting schedule.',
      {
        start_time: settings.start_time,
        injection_day: settings.injection_day,
        injection_time: settings.injection_time,
        timezone: settings.timezone,
        interval_days: settings.interval_days,
      },
    );
    return;
  }

  const timezone =
    settings.timezone && isValidTimeZone(settings.timezone)
      ? settings.timezone
      : 'UTC';

  // Catch-up: if we missed the last scheduled prompt, send a catch-up notice
  const intervalDaysNum = Number(settings.interval_days) || 7;
  const lastRun = settings.last_run_at
    ? DateTime.fromISO(settings.last_run_at, { zone: timezone })
    : null;
  const previousInjection = nextInjectionDate.minus({ days: intervalDaysNum });
  if (!lastRun || (previousInjection.isValid && lastRun < previousInjection)) {
    try {
      const channel = (await client.channels.fetch(channelId).catch((err) => {
        logger.error(
          `Failed to fetch channel ${channelId} for catch-up prompt:`,
          err,
        );
        return null;
      })) as TextChannel | null;
      if (channel) {
        const medLabel =
          settings.medication || settings.medication === ''
            ? settings.medication
            : 'Injection';
        const doseLabel =
          settings.dose_mg !== null && settings.dose_mg !== undefined
            ? `Dose: **${settings.dose_mg} mg**`
            : '';
        const catchupEmbed = new EmbedBuilder()
          .setTitle(`${medLabel} Reminder (Catch-up)`)
          .setDescription(
            `A scheduled reminder may have been missed while the bot was offline. Please ensure your last injection is logged.${doseLabel ? `\n${doseLabel}` : ''}`,
          )
          .setColor(0xe67e22)
          .setTimestamp();
        await channel.send({ embeds: [catchupEmbed] });
        logger.info('Sent catch-up injection reminder.');
      }
      await updateSchedulerRunTimes(new Date().toISOString(), undefined);
    } catch (err) {
      logger.error('Failed to send catch-up reminder', err);
    }
  }

  const getLatestInjectionDateTime = async (tz: string) => {
    try {
      const latest = await getLastRecord();
      if (!latest) return null;
      const source = latest.performed_at ?? latest.injection_date;
      if (!source) return null;
      const dt = DateTime.fromISO(String(source), { zone: tz });
      if (dt.isValid) return dt;
      const fallback = DateTime.fromJSDate(new Date(String(source))).setZone(tz);
      return fallback.isValid ? fallback : null;
    } catch (err) {
      logger.error('Failed to fetch latest injection before sending reminder/prompt', err);
      return null;
    }
  };

  const scheduleNext = async () => {
    await internalScheduleJobs(client, currentSettings as GlobalSettings);
  };

  const sendPrompt = async () => {
    logger.info(
      `Injection prompt triggered for ${nextInjectionDate.toISO()} (${timezone}).`,
    );

    const latestInjection = await getLatestInjectionDateTime(timezone);
    if (latestInjection && latestInjection >= previousInjection) {
      logger.info(
        `Skipping prompt; latest injection at ${latestInjection.toISO()} already logged for this interval.`,
      );
      await updateSchedulerRunTimes(new Date().toISOString(), undefined);
      await scheduleNext();
      return;
    }

    try {
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

      const medLabel =
        settings.medication || settings.medication === ''
          ? settings.medication
          : 'Injection';
      const doseLabel =
        settings.dose_mg !== null && settings.dose_mg !== undefined
          ? `Dose: **${settings.dose_mg} mg**`
          : '';

      const promptEmbed = new EmbedBuilder()
        .setTitle(`${medLabel} Reminder`)
        .setDescription(
          `It's injection time! Please log your injection using the \`/injection\` command.${doseLabel ? `\n${doseLabel}` : ''}`,
        )
        .setColor(0x1abc9c)
        .setThumbnail(
          'https://cdn1.iconfinder.com/data/icons/medical-1-3/128/3-512.png',
        )
        .setTimestamp();

      await channel.send({ embeds: [promptEmbed] }); // Line 87 area
      logger.info(`Sent injection prompt to channel ${channelId}.`); // Added for clarity
      await updateSchedulerRunTimes(new Date().toISOString(), undefined);
    } catch (error) {
      // Closing brace for try, opening for catch
      logger.error('Error in injection prompt job execution:', error);
    } // Closing brace for catch
    // After prompt, schedule next cycle
    await scheduleNext();
  };

  const sendReminder = async () => {
    logger.info(`Injection reminder triggered for 1 hour before schedule.`);

    const latestInjection = await getLatestInjectionDateTime(timezone);
    if (latestInjection && latestInjection >= previousInjection) {
      logger.info(
        `Skipping reminder; latest injection at ${latestInjection.toISO()} already logged for this interval.`,
      );
      await updateSchedulerRunTimes(new Date().toISOString(), undefined);
      await scheduleNext();
      return;
    }

    try {
      const channel = (await client.channels.fetch(channelId).catch((err) => {
        logger.error(`Failed to fetch channel ${channelId} for reminder:`, err);
        return null;
      })) as TextChannel | null;

      if (!channel) {
        logger.error(
          `Designated channel ${channelId} not found or accessible for injection reminder.`,
        );
        return;
      }

      const medLabel =
        settings.medication || settings.medication === ''
          ? settings.medication
          : 'Injection';
      const doseLabel =
        settings.dose_mg !== null && settings.dose_mg !== undefined
          ? `Dose: **${settings.dose_mg} mg**`
          : '';

      const reminderEmbed = new EmbedBuilder()
        .setTitle(`${medLabel} Reminder - 1 Hour Left`)
        .setDescription(
          `Reminder: Your injection is scheduled in approximately 1 hour. Get ready!${doseLabel ? `\n${doseLabel}` : ''}`,
        )
        .setColor(0xf1c40f)
        .setThumbnail(
          'https://cdn-icons-png.flaticon.com/512/3075/3075977.png',
        )
        .setTimestamp();

      await channel.send({ embeds: [reminderEmbed] });
      logger.info(`Sent injection reminder to channel ${channelId}.`);
      await updateSchedulerRunTimes(new Date().toISOString(), undefined);
    } catch (error) {
      logger.error('Error in injection reminder job execution:', error);
    }
  };

  logger.info(
    `Scheduling prompt at ${nextInjectionDate.toISO()} (${timezone}) with interval ${settings.interval_days} day(s).`,
  );

  promptTimeout = scheduleTimeout(nextInjectionDate, sendPrompt, 'prompt');

  const reminderDateTime = nextInjectionDate.minus({ hours: 1 });
  if (reminderDateTime > DateTime.now().setZone(timezone)) {
    reminderTimeout = scheduleTimeout(
      reminderDateTime,
      sendReminder,
      'reminder',
    );
    logger.info(
      `Scheduling reminder at ${reminderDateTime.toISO()} (${timezone}).`,
    );
  } else {
    logger.warn('Reminder time is already past; skipping for this cycle.');
  }

  // --- Hormone test reminder (E/T labs) ---
  const sendTestReminder = async () => {
    try {
      const channel = (await client.channels.fetch(channelId).catch((err) => {
        logger.error(
          `Failed to fetch channel ${channelId} for hormone test reminder:`,
          err,
        );
        return null;
      })) as TextChannel | null;

      if (!channel) {
        logger.error(
          `Designated channel ${channelId} not found or accessible for hormone test reminder.`,
        );
        return;
      }

      const tz = settings.test_timezone ?? timezone;
      const startLabel = settings.test_start_time ?? 'not set';
      const intervalLabel = settings.test_interval_days ?? 30;

      const testEmbed = new EmbedBuilder()
        .setTitle('Hormone Test Reminder')
        .setDescription(
          `Time to schedule or perform your E/T labs (through day check).\nStart: ${startLabel}\nInterval: every ${intervalLabel} day(s)\nTimezone: ${tz}`,
        )
        .setColor(0x8e44ad)
        .setTimestamp();

      await channel.send({ embeds: [testEmbed] });
      logger.info(`Sent hormone test reminder to channel ${channelId}.`);
      await updateSchedulerRunTimes(undefined, new Date().toISOString());
    } catch (error) {
      logger.error('Error in hormone test reminder execution:', error);
    }
    scheduleTestReminder();
  };

  const scheduleTestReminder = () => {
    if (
      settings.test_start_time &&
      settings.test_interval_days &&
      settings.test_interval_days > 0
    ) {
      const nextTest = getNextFromAnchor(
        settings.test_start_time,
        Number(settings.test_interval_days),
        settings.test_timezone ?? timezone,
      );
      if (nextTest) {
        const lastTestRun = settings.test_last_run_at
          ? DateTime.fromISO(settings.test_last_run_at, {
              zone: settings.test_timezone ?? timezone,
            })
          : null;
        const prevTest = nextTest.minus({
          days: Number(settings.test_interval_days),
        });
        if (!lastTestRun || (prevTest.isValid && lastTestRun < prevTest)) {
          // Fire a catch-up test reminder
          void (async () => {
            try {
              const channel = (await client.channels.fetch(channelId).catch(
                (err) => {
                  logger.error(
                    `Failed to fetch channel ${channelId} for test catch-up:`,
                    err,
                  );
                  return null;
                },
              )) as TextChannel | null;
              if (channel) {
                const testEmbed = new EmbedBuilder()
                  .setTitle('Hormone Test Reminder (Catch-up)')
                  .setDescription(
                    `A scheduled hormone test reminder may have been missed while the bot was offline. Please verify your upcoming labs.`,
                  )
                  .setColor(0x8e44ad)
                  .setTimestamp();
                await channel.send({ embeds: [testEmbed] });
                await updateSchedulerRunTimes(undefined, new Date().toISOString());
              }
            } catch (err) {
              logger.error('Failed to send test catch-up reminder', err);
            }
          })();
        }

        testReminderTimeout = scheduleTimeout(
          nextTest,
          sendTestReminder,
          'hormone-test',
        );
        logger.info(
          `Scheduled hormone test reminder at ${nextTest.toISO()} (${settings.test_timezone ?? timezone}) every ${settings.test_interval_days} day(s).`,
        );
      }
    }
  };

  scheduleTestReminder();
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
  if (!isValidTimeZone(settings.timezone)) {
    logger.warn(
      `Configured timezone "${settings.timezone}" is invalid. Falling back to UTC for scheduling.`,
    );
    settings.timezone = 'UTC';
  }
  logger.info(
    `Loaded initial settings: Day ${settings.injection_day}, Time ${settings.injection_time}, TZ ${settings.timezone}, Interval ${settings.interval_days} day(s)`,
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
  if (!isValidTimeZone(settings.timezone)) {
    logger.warn(
      `Configured timezone "${settings.timezone}" is invalid. Falling back to UTC for scheduling.`,
    );
    settings.timezone = 'UTC';
  }
  logger.info(
    `Loaded updated settings: Day ${settings.injection_day}, Time ${settings.injection_time}, TZ ${settings.timezone}, Interval ${settings.interval_days} day(s)`,
  );
  await internalScheduleJobs(currentClient, settings); // Call internal function
  logger.info('Jobs rescheduled successfully.');
} // Closing brace for rescheduleJobs
