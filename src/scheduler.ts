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
const NAG_INTERVAL_HOURS = 1;
const NAG_CAP_HOURS = 12;

let promptTimeout: NodeJS.Timeout | null = null;
let reminderTimeout: NodeJS.Timeout | null = null;
let testReminderTimeout: NodeJS.Timeout | null = null;
let nagTimeout: NodeJS.Timeout | null = null;
let currentNagTick: (() => Promise<void>) | null = null;
let nagDeadline: DateTime | null = null;
let currentClient: Client | null = null;
let currentSettings: GlobalSettings | null = null;
let nextPromptTarget: DateTime | null = null;
let nextReminderTarget: DateTime | null = null;

function ownerMention(): string | undefined {
  return config.botOwnerId ? `<@${config.botOwnerId}>` : undefined;
}

async function fetchChannelWithRetry(
  client: Client,
  channelId: string,
  retries = 2,
  delayMs = 1000,
): Promise<TextChannel | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const channel = (await client.channels.fetch(channelId)) as TextChannel | null;
      if (channel) return channel;
    } catch (err) {
      logger.warn(
        `Failed to fetch channel ${channelId} (attempt ${attempt + 1}/${retries + 1})`,
        err,
      );
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  return null;
}

// Renamed internal function slightly to avoid potential conflict with export name if any
function clearScheduled() {
  if (promptTimeout) {
    clearTimeout(promptTimeout);
    promptTimeout = null;
    nextPromptTarget = null;
    logger.info('Cleared existing prompt timeout.');
  }
  if (reminderTimeout) {
    clearTimeout(reminderTimeout);
    reminderTimeout = null;
    nextReminderTarget = null;
    logger.info('Cleared existing reminder timeout.');
  }
  if (testReminderTimeout) {
    clearTimeout(testReminderTimeout);
    testReminderTimeout = null;
    logger.info('Cleared existing hormone test reminder timeout.');
  }
  if (nagTimeout) {
    clearTimeout(nagTimeout);
    nagTimeout = null;
    currentNagTick = null;
    nagDeadline = null;
    logger.info('Cleared existing injection nag timeout.');
  }
}

export function snoozeNag(hours: number): 'snoozed' | 'no-active-nag' {
  if (!nagTimeout || !currentNagTick) return 'no-active-nag';
  clearTimeout(nagTimeout);
  if (nagDeadline) {
    nagDeadline = nagDeadline.plus({ hours });
  }
  const tick = currentNagTick;
  nagTimeout = setTimeout(() => void tick(), hours * 60 * 60 * 1000);
  logger.info(`Injection nag snoozed for ${hours}h.`);
  return 'snoozed';
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
      const channel = await fetchChannelWithRetry(client, channelId, 2, 1500);
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
        await channel.send({ content: ownerMention(), embeds: [catchupEmbed] });
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
      const channel = await fetchChannelWithRetry(client, channelId, 2, 1500);

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

      await channel.send({ content: ownerMention(), embeds: [promptEmbed] }); // Line 87 area
      logger.info(`Sent injection prompt to channel ${channelId}.`); // Added for clarity
      await updateSchedulerRunTimes(new Date().toISOString(), undefined);
    } catch (error) {
      // Closing brace for try, opening for catch
      logger.error('Error in injection prompt job execution:', error);
    } // Closing brace for catch
    // After prompt, schedule next cycle
    await scheduleNext();
    startNagLoop();
  };

  const sendNagPing = async () => {
    const latestInjection = await getLatestInjectionDateTime(timezone);
    if (latestInjection && latestInjection >= previousInjection) {
      logger.info('Stopping injection nag; injection has been logged.');
      nagTimeout = null;
      currentNagTick = null;
      nagDeadline = null;
      return;
    }

    const now = DateTime.now().setZone(timezone);
    if (!nagDeadline || now >= nagDeadline) {
      logger.info('Injection nag cap reached; giving up until next cycle.');
      nagTimeout = null;
      currentNagTick = null;
      nagDeadline = null;
      return;
    }

    try {
      const channel = await fetchChannelWithRetry(client, channelId, 2, 1500);
      if (channel) {
        const medLabel =
          settings.medication || settings.medication === ''
            ? settings.medication
            : 'Injection';

        const nagEmbed = new EmbedBuilder()
          .setTitle(`${medLabel} still not logged`)
          .setDescription(
            `This is still unlogged. Use \`/injection\` when you can, or \`/snooze <hours>\` if you need more time.`,
          )
          .setColor(0xe74c3c)
          .setTimestamp();

        await channel.send({ content: ownerMention(), embeds: [nagEmbed] });
        logger.info(`Sent hourly injection nag to channel ${channelId}.`);
      }
    } catch (error) {
      logger.error('Error sending injection nag:', error);
    }

    nagTimeout = setTimeout(
      () => void sendNagPing(),
      NAG_INTERVAL_HOURS * 60 * 60 * 1000,
    );
  };

  const startNagLoop = () => {
    if (nagTimeout) return;
    nagDeadline = DateTime.now().setZone(timezone).plus({
      hours: NAG_CAP_HOURS,
    });
    currentNagTick = sendNagPing;
    nagTimeout = setTimeout(
      () => void sendNagPing(),
      NAG_INTERVAL_HOURS * 60 * 60 * 1000,
    );
    logger.info(
      `Started hourly injection nag, capped at ${NAG_CAP_HOURS}h (until ${nagDeadline.toISO()}).`,
    );
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
      const channel = await fetchChannelWithRetry(client, channelId, 2, 1500);

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

      await channel.send({ content: ownerMention(), embeds: [reminderEmbed] });
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
  nextPromptTarget = nextInjectionDate;

  const reminderDateTime = nextInjectionDate.minus({ hours: 1 });
  if (reminderDateTime > DateTime.now().setZone(timezone)) {
    reminderTimeout = scheduleTimeout(
      reminderDateTime,
      sendReminder,
      'reminder',
    );
    nextReminderTarget = reminderDateTime;
    logger.info(
      `Scheduling reminder at ${reminderDateTime.toISO()} (${timezone}).`,
    );
  } else {
    logger.warn('Reminder time is already past; skipping for this cycle.');
  }

  // --- Hormone test reminder (E/T labs) ---
  const sendTestReminder = async () => {
    try {
      const channel = await fetchChannelWithRetry(client, channelId, 2, 1500);

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

      await channel.send({ content: ownerMention(), embeds: [testEmbed] });
      logger.info(`Sent hormone test reminder to channel ${channelId}.`);
      await updateSchedulerRunTimes(undefined, new Date().toISOString());
    } catch (error) {
      logger.error('Error in hormone test reminder execution:', error);
    }
    await scheduleTestReminder();
  };

  const scheduleTestReminder = async () => {
    if (
      !settings.test_start_time ||
      !settings.test_interval_days ||
      settings.test_interval_days <= 0
    ) return;

    const nextTest = getNextFromAnchor(
      settings.test_start_time,
      Number(settings.test_interval_days),
      settings.test_timezone ?? timezone,
    );
    if (!nextTest) return;

    const lastTestRun = settings.test_last_run_at
      ? DateTime.fromISO(settings.test_last_run_at, {
          zone: settings.test_timezone ?? timezone,
        })
      : null;
    const prevTest = nextTest.minus({ days: Number(settings.test_interval_days) });

    if (!lastTestRun || (prevTest.isValid && lastTestRun < prevTest)) {
      try {
        const channel = await fetchChannelWithRetry(client, channelId, 2, 1500);
        if (channel) {
          const testEmbed = new EmbedBuilder()
            .setTitle('Hormone Test Reminder (Catch-up)')
            .setDescription(
              `A scheduled hormone test reminder may have been missed while the bot was offline. Please verify your upcoming labs.`,
            )
            .setColor(0x8e44ad)
            .setTimestamp();
          await channel.send({ content: ownerMention(), embeds: [testEmbed] });
          await updateSchedulerRunTimes(undefined, new Date().toISOString());
        } else {
          logger.error(`Designated channel ${channelId} not found for test catch-up reminder.`);
        }
      } catch (err) {
        logger.error('Failed to send test catch-up reminder', err);
      }
    }

    testReminderTimeout = scheduleTimeout(nextTest, sendTestReminder, 'hormone-test');
    logger.info(
      `Scheduled hormone test reminder at ${nextTest.toISO()} (${settings.test_timezone ?? timezone}) every ${settings.test_interval_days} day(s).`,
    );
  };

  await scheduleTestReminder();
} // Closing brace for internalScheduleJobs

export function getSchedulerStatus() {
  return {
    initialized: Boolean(currentSettings),
    promptScheduled: Boolean(promptTimeout),
    reminderScheduled: Boolean(reminderTimeout),
    nextPromptISO: nextPromptTarget?.toISO() ?? null,
    nextReminderISO: nextReminderTarget?.toISO() ?? null,
    nagActive: Boolean(nagTimeout),
    nagDeadlineISO: nagDeadline?.toISO() ?? null,
    timezone: currentSettings?.timezone ?? null,
  };
}

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
