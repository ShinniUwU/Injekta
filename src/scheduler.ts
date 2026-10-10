// src/scheduler.ts
// One set of timers per personal schedule, plus hormone test reminders per
// server. Each person is reminded by DM or in the server's channel, depending
// on their /privacy setting.
import type { Client, TextChannel } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { DateTime } from 'luxon';
import type { GuildSettings, RemindVia, UserSchedule } from './database';
import {
  getAllGuildSettings,
  getAllUserSchedules,
  getAllUserSettings,
  getGuildSettings,
  getLatestInjectionTimes,
  getUserSchedule,
  updateTestRunTime,
  updateUserRunTime,
} from './database';
import logger from './logger';
import { config } from './config';
import type { ScheduleLike } from './time';
import {
  getNextFromAnchor,
  getNextInjectionDateTime,
  isValidTimeZone,
} from './time';

const MAX_TIMEOUT = 2 ** 31 - 1;
const NAG_INTERVAL_HOURS = 1;
const NAG_CAP_HOURS = 12;

interface Job {
  key: string;
  guildId: string;
  timers: {
    prompt?: NodeJS.Timeout;
    reminder?: NodeJS.Timeout;
    test?: NodeJS.Timeout;
    nag?: NodeJS.Timeout;
  };
  nextPrompt: DateTime | null;
  nextReminder: DateTime | null;
  nextTest: DateTime | null;
  nagDeadline: DateTime | null;
  nagUsers: Set<string>;
}

interface Schedule extends ScheduleLike {
  medication: string | null;
  dose_mg: number | null;
  last_run_at: string | null;
}

interface ScheduleDef {
  job: Job;
  schedule: Schedule;
  // User IDs this schedule reminds
  candidates: () => Promise<string[]>;
  saveRun: (iso: string) => Promise<void>;
}

interface Recipient {
  userId: string;
  via: RemindVia;
}

type MessageKind = 'catchup' | 'reminder' | 'prompt' | 'nag';

const jobs = new Map<string, Job>();
const snoozedUntil = new Map<string, DateTime>();
let currentClient: Client | null = null;

const serverKey = (guildId: string) => `server:${guildId}`;
const personalKey = (guildId: string, userId: string) =>
  `user:${guildId}:${userId}`;

function laterOf(a: DateTime, b?: DateTime): DateTime {
  return b && b > a ? b : a;
}

function clearTimers(job: Job, which: (keyof Job['timers'])[]) {
  for (const name of which) {
    const handle = job.timers[name];
    if (handle) clearTimeout(handle);
    job.timers[name] = undefined;
  }
  if (which.includes('prompt')) job.nextPrompt = null;
  if (which.includes('reminder')) job.nextReminder = null;
  if (which.includes('test')) job.nextTest = null;
  if (which.includes('nag')) {
    job.nagDeadline = null;
    job.nagUsers = new Set();
  }
}

function replaceJob(key: string, guildId: string): Job {
  const existing = jobs.get(key);
  if (existing) clearTimers(existing, ['prompt', 'reminder', 'test', 'nag']);
  const job: Job = {
    key,
    guildId,
    timers: {},
    nextPrompt: null,
    nextReminder: null,
    nextTest: null,
    nagDeadline: null,
    nagUsers: new Set(),
  };
  jobs.set(key, job);
  return job;
}

function removeJob(key: string) {
  const existing = jobs.get(key);
  if (existing) clearTimers(existing, ['prompt', 'reminder', 'test', 'nag']);
  jobs.delete(key);
}

// Long waits are split into chunks; onHandle receives every new handle so the
// caller can always clear the one that is currently pending.
function scheduleTimeout(
  target: DateTime,
  callback: () => Promise<void>,
  label: string,
  onHandle: (handle: NodeJS.Timeout) => void,
): void {
  const scheduleChunk = () => {
    const delayMs = target.diff(DateTime.now(), 'milliseconds').milliseconds;
    if (delayMs <= 0) {
      logger.warn(
        `${label} time is in the past; executing immediately. target=${target.toISO()}`,
      );
      void callback();
      return;
    }
    if (delayMs > MAX_TIMEOUT) {
      onHandle(setTimeout(scheduleChunk, MAX_TIMEOUT));
    } else {
      onHandle(setTimeout(() => void callback(), delayMs));
    }
  };
  scheduleChunk();
}

async function fetchChannelWithRetry(
  client: Client,
  channelId: string,
  retries = 2,
  delayMs = 1500,
): Promise<TextChannel | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const channel = (await client.channels.fetch(
        channelId,
      )) as TextChannel | null;
      if (channel) return channel;
    } catch (err) {
      logger.warn(
        `Failed to fetch channel ${channelId} (attempt ${attempt + 1}/${
          retries + 1
        })`,
        err,
      );
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  return null;
}

function isSnoozed(guildId: string, userId: string): boolean {
  const until = snoozedUntil.get(`${guildId}:${userId}`);
  return Boolean(until && DateTime.now() < until);
}

// Users from `userIds` who haven't logged an injection since `since`.
async function pendingRecipients(
  guildId: string,
  userIds: string[],
  since: DateTime,
): Promise<Recipient[]> {
  if (userIds.length === 0) return [];
  const [latest, settings] = await Promise.all([
    getLatestInjectionTimes(guildId),
    getAllUserSettings(guildId),
  ]);
  return userIds
    .filter((id) => {
      const last = latest.get(id);
      return !last || DateTime.fromISO(last) < since;
    })
    .map((id) => ({ userId: id, via: settings.get(id)?.remind_via ?? 'dm' }));
}

// Channel embeds never include medication or dose; those only go in DMs.
function buildEmbed(
  kind: MessageKind,
  schedule: Schedule,
  forDm: boolean,
  guildName?: string,
) {
  const med = forDm && schedule.medication ? schedule.medication : 'Injection';
  const dose =
    forDm && schedule.dose_mg !== null && schedule.dose_mg !== undefined
      ? `\nDose: **${schedule.dose_mg} mg**`
      : '';
  const from = forDm && guildName ? `\n-# From ${guildName}` : '';
  const content = {
    catchup: {
      title: `${med} Reminder (Catch-up)`,
      text: 'A scheduled reminder may have been missed while the bot was offline. Please make sure your last injection is logged.',
      color: 0xe67e22,
    },
    reminder: {
      title: `${med} Reminder - 1 Hour Left`,
      text: 'Your injection is scheduled in about 1 hour. Get ready!',
      color: 0xf1c40f,
    },
    prompt: {
      title: `${med} Reminder`,
      text: "It's injection time! Log it with `/injection` in the server.",
      color: 0x1abc9c,
    },
    nag: {
      title: `${med} still not logged`,
      text: 'This is still unlogged. Use `/injection` when you can, or `/snooze <hours>` if you need more time.',
      color: 0xe74c3c,
    },
  }[kind];
  return new EmbedBuilder()
    .setTitle(content.title)
    .setDescription(`${content.text}${dose}${from}`)
    .setColor(content.color)
    .setTimestamp();
}

async function deliver(
  guildId: string,
  recipients: Recipient[],
  kind: MessageKind,
  schedule: Schedule,
) {
  const client = currentClient;
  if (!client) return;
  const guildName = client.guilds.cache.get(guildId)?.name;

  for (const recipient of recipients.filter((r) => r.via === 'dm')) {
    try {
      const user = await client.users.fetch(recipient.userId);
      await user.send({
        embeds: [buildEmbed(kind, schedule, true, guildName)],
      });
    } catch (error) {
      // No channel fallback: the user chose DMs, so we don't post in public.
      logger.warn(
        `Could not DM ${kind} to user ${recipient.userId}; they may have DMs closed.`,
        { error },
      );
    }
  }

  const channelUsers = recipients
    .filter((r) => r.via === 'channel')
    .map((r) => r.userId);
  if (channelUsers.length === 0) return;

  const channelId = (await getGuildSettings(guildId))?.channel_id;
  if (!channelId) {
    logger.warn(
      `Server ${guildId} has no reminder channel; skipped channel ${kind}.`,
    );
    return;
  }
  const channel = await fetchChannelWithRetry(client, channelId);
  if (!channel) {
    logger.error(`Reminder channel ${channelId} not found or not accessible.`);
    return;
  }
  await channel.send({
    content: channelUsers.map((id) => `<@${id}>`).join(' '),
    embeds: [buildEmbed(kind, schedule, false)],
    allowedMentions: { users: channelUsers },
  });
}

function startNag(def: ScheduleDef, cycleStart: DateTime, users: Recipient[]) {
  const { job } = def;
  if (job.timers.nag || users.length === 0) return;
  job.nagDeadline = DateTime.now().plus({ hours: NAG_CAP_HOURS });
  job.nagUsers = new Set(users.map((u) => u.userId));

  const tick = async () => {
    job.timers.nag = undefined;
    try {
      if (!job.nagDeadline || DateTime.now() >= job.nagDeadline) {
        logger.info(`Nag cap reached for ${job.key}.`);
        clearTimers(job, ['nag']);
        return;
      }
      const stillPending = await pendingRecipients(
        job.guildId,
        [...job.nagUsers],
        cycleStart,
      );
      job.nagUsers = new Set(stillPending.map((r) => r.userId));
      if (job.nagUsers.size === 0) {
        logger.info(`Stopping nag for ${job.key}; everyone has logged.`);
        clearTimers(job, ['nag']);
        return;
      }
      const toPing = stillPending.filter(
        (r) => !isSnoozed(job.guildId, r.userId),
      );
      if (toPing.length) {
        await deliver(job.guildId, toPing, 'nag', def.schedule);
      }
    } catch (error) {
      logger.error(`Error sending nag for ${job.key}:`, error);
    }
    job.timers.nag = setTimeout(
      () => void tick(),
      NAG_INTERVAL_HOURS * 60 * 60 * 1000,
    );
  };

  job.timers.nag = setTimeout(
    () => void tick(),
    NAG_INTERVAL_HOURS * 60 * 60 * 1000,
  );
  logger.info(
    `Started hourly nag for ${job.key}, capped at ${NAG_CAP_HOURS}h.`,
  );
}

// `after` is the slot that just fired. Timers can wake slightly early, so the
// next slot is computed from whichever is later: now or `after`.
async function runInjectionSchedule(def: ScheduleDef, after?: DateTime) {
  const { job, schedule } = def;
  clearTimers(job, ['prompt', 'reminder']);

  const timezone = isValidTimeZone(schedule.timezone)
    ? schedule.timezone
    : 'UTC';
  const interval = Number(schedule.interval_days) || 7;
  const next = getNextInjectionDateTime(
    { ...schedule, timezone },
    laterOf(DateTime.now().setZone(timezone), after),
  );
  if (!next || !schedule.start_time) {
    logger.error(`Could not compute next injection for ${job.key}.`);
    return;
  }
  const previous = next.minus({ days: interval });

  const markRun = async () => {
    const iso = new Date().toISOString();
    await def.saveRun(iso);
    schedule.last_run_at = iso;
  };

  // Logged anywhere in [slot - interval, now] counts as done for that slot.
  const sendSlot = async (kind: MessageKind, slot: DateTime) => {
    const candidates = await def.candidates();
    const pending = await pendingRecipients(
      job.guildId,
      candidates,
      slot.minus({ days: interval }),
    );
    if (pending.length) {
      await deliver(job.guildId, pending, kind, schedule);
      logger.info(`Sent ${kind} for ${job.key} to ${pending.length} user(s).`);
    } else {
      logger.info(`Skipped ${kind} for ${job.key}; everyone already logged.`);
    }
    await markRun();
    return pending;
  };

  // Catch-up: nothing can have been missed before the schedule's first slot.
  const anchor = DateTime.fromISO(schedule.start_time, { zone: timezone });
  const lastRun = schedule.last_run_at
    ? DateTime.fromISO(schedule.last_run_at)
    : null;
  const previousWasDue =
    previous.isValid && (!anchor.isValid || previous >= anchor);
  if (previousWasDue && (!lastRun || lastRun < previous)) {
    try {
      await sendSlot('catchup', previous);
    } catch (error) {
      logger.error(`Failed to send catch-up for ${job.key}`, error);
    }
  }

  const reminderAt = next.minus({ hours: 1 });
  if (reminderAt > DateTime.now()) {
    scheduleTimeout(
      reminderAt,
      async () => {
        try {
          await sendSlot('reminder', next);
        } catch (error) {
          logger.error(`Error sending reminder for ${job.key}:`, error);
        }
      },
      `${job.key} reminder`,
      (handle) => {
        job.timers.reminder = handle;
      },
    );
    job.nextReminder = reminderAt;
  }

  scheduleTimeout(
    next,
    async () => {
      let pending: Recipient[] = [];
      try {
        pending = await sendSlot('prompt', next);
      } catch (error) {
        logger.error(`Error sending prompt for ${job.key}:`, error);
      }
      await runInjectionSchedule(def, next);
      startNag(def, previous, pending);
    },
    `${job.key} prompt`,
    (handle) => {
      job.timers.prompt = handle;
    },
  );
  job.nextPrompt = next;
  logger.info(
    `Scheduled ${
      job.key
    } prompt at ${next.toISO()} (every ${interval} day(s)).`,
  );
}

// Hormone test reminders are per server and posted in the server channel.
async function runTestSchedule(
  job: Job,
  settings: GuildSettings,
  after?: DateTime,
) {
  clearTimers(job, ['test']);
  const interval = Number(settings.test_interval_days);
  if (!settings.test_start_time || !(interval > 0)) return;

  const tz = settings.test_timezone ?? 'UTC';
  const nextTest = getNextFromAnchor(
    settings.test_start_time,
    interval,
    tz,
    laterOf(DateTime.now(), after),
  );
  if (!nextTest) return;

  const post = async (catchUp: boolean) => {
    const client = currentClient;
    const channelId = (await getGuildSettings(job.guildId))?.channel_id;
    if (!client || !channelId) {
      logger.warn(`No reminder channel for hormone test in ${job.guildId}.`);
      return;
    }
    const channel = await fetchChannelWithRetry(client, channelId);
    if (!channel) {
      throw new Error(`Reminder channel ${channelId} not accessible.`);
    }
    const ownerPing =
      job.guildId === config.guildId && config.botOwnerId
        ? `<@${config.botOwnerId}>`
        : undefined;
    await channel.send({
      content: ownerPing,
      embeds: [
        new EmbedBuilder()
          .setTitle(
            catchUp
              ? 'Hormone Test Reminder (Catch-up)'
              : 'Hormone Test Reminder',
          )
          .setDescription(
            catchUp
              ? 'A scheduled hormone test reminder may have been missed while the bot was offline. Please verify your upcoming labs.'
              : `Time to schedule or perform your E/T labs (trough day check).\nInterval: every ${interval} day(s)`,
          )
          .setColor(0x8e44ad)
          .setTimestamp(),
      ],
    });
    const iso = new Date().toISOString();
    await updateTestRunTime(job.guildId, iso);
    settings.test_last_run_at = iso;
  };

  const prevTest = nextTest.minus({ days: interval });
  const testAnchor = DateTime.fromISO(settings.test_start_time, { zone: tz });
  const lastTestRun = settings.test_last_run_at
    ? DateTime.fromISO(settings.test_last_run_at)
    : null;
  const prevTestWasDue =
    prevTest.isValid && (!testAnchor.isValid || prevTest >= testAnchor);
  if (prevTestWasDue && (!lastTestRun || lastTestRun < prevTest)) {
    await post(true).catch((err) =>
      logger.error('Failed to send test catch-up reminder', err),
    );
  }

  scheduleTimeout(
    nextTest,
    async () => {
      await post(false).catch((err) =>
        logger.error('Error sending hormone test reminder:', err),
      );
      await runTestSchedule(job, settings, nextTest);
    },
    `${job.key} hormone-test`,
    (handle) => {
      job.timers.test = handle;
    },
  );
  job.nextTest = nextTest;
}

async function scheduleServer(settings: GuildSettings) {
  const guildId = settings.guild_id;
  const job = replaceJob(serverKey(guildId), guildId);
  await runTestSchedule(job, settings);
}

async function schedulePersonal(schedule: UserSchedule) {
  const { guild_id: guildId, user_id: userId } = schedule;
  const job = replaceJob(personalKey(guildId, userId), guildId);
  await runInjectionSchedule({
    job,
    schedule,
    candidates: async () => [userId],
    saveRun: (iso) => updateUserRunTime(guildId, userId, iso),
  });
}

export async function initializeScheduler(client: Client) {
  logger.info('Initializing scheduler...');
  currentClient = client;
  for (const settings of await getAllGuildSettings()) {
    await scheduleServer(settings).catch((error) =>
      logger.error(`Failed to schedule server ${settings.guild_id}`, error),
    );
  }
  for (const schedule of await getAllUserSchedules()) {
    await schedulePersonal(schedule).catch((error) =>
      logger.error(`Failed to schedule personal reminders`, error),
    );
  }
  logger.info(`Scheduler running ${jobs.size} schedule(s).`);
}

export async function rescheduleGuild(guildId: string) {
  if (!currentClient) {
    logger.error('Cannot reschedule: client not available.');
    return;
  }
  const settings = await getGuildSettings(guildId);
  if (settings) await scheduleServer(settings);
  else removeJob(serverKey(guildId));
}

export async function reschedulePersonal(guildId: string, userId: string) {
  if (!currentClient) {
    logger.error('Cannot reschedule: client not available.');
    return;
  }
  const schedule = await getUserSchedule(guildId, userId);
  if (schedule) await schedulePersonal(schedule);
  else removeJob(personalKey(guildId, userId));
}

export function snoozeNag(
  guildId: string,
  userId: string,
  hours: number,
): 'snoozed' | 'no-active-nag' {
  const active = [...jobs.values()].filter(
    (job) =>
      job.guildId === guildId && job.timers.nag && job.nagUsers.has(userId),
  );
  if (active.length === 0) return 'no-active-nag';
  const until = DateTime.now().plus({ hours });
  snoozedUntil.set(`${guildId}:${userId}`, until);
  // Make sure the nag is still running when the snooze ends
  for (const job of active) {
    const minDeadline = until.plus({ hours: NAG_INTERVAL_HOURS });
    if (!job.nagDeadline || job.nagDeadline < minDeadline) {
      job.nagDeadline = minDeadline;
    }
  }
  logger.info(`Nag snoozed for ${hours}h.`);
  return 'snoozed';
}

export function getSchedulerStatus(guildId: string) {
  const server = jobs.get(serverKey(guildId));
  const personal = [...jobs.values()].filter(
    (job) => job.guildId === guildId && job.key !== serverKey(guildId),
  );
  return {
    initialized: Boolean(currentClient),
    nextTestISO: server?.nextTest?.toISO() ?? null,
    personalSchedules: personal.length,
    activeNags: personal.filter((job) => job.timers.nag).length,
  };
}
