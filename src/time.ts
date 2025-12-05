import { DateTime, IANAZone } from 'luxon';
import type { GlobalSettings } from './database';

const supportedZones =
  typeof Intl.supportedValuesOf === 'function'
    ? new Set(Intl.supportedValuesOf('timeZone'))
    : null;

export function isValidTimeZone(zone: string): boolean {
  if (!zone) return false;
  if (supportedZones && supportedZones.has(zone)) return true;
  return IANAZone.isValidZone(zone);
}

function toLuxonWeekday(injectionDay: number): number {
  // injection_day is 0 (Sunday) to 6 (Saturday); Luxon uses 1 (Mon) to 7 (Sun)
  return injectionDay === 0 ? 7 : injectionDay;
}

export function getAnchorDateTime(
  injectionDay: number,
  injectionTime: string,
  timezone: string,
  now: DateTime = DateTime.now(),
): DateTime | null {
  if (!isValidTimeZone(timezone)) return null;
  const [hourStr, minuteStr] = injectionTime.split(':');
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  if (
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  const zonedNow = now.setZone(timezone);
  const targetWeekday = toLuxonWeekday(injectionDay);
  let anchor = zonedNow.set({ hour, minute, second: 0, millisecond: 0 });
  const daysUntil = (targetWeekday - zonedNow.weekday + 7) % 7;
  anchor = anchor.plus({ days: daysUntil });
  if (daysUntil === 0 && anchor <= zonedNow) {
    anchor = anchor.plus({ days: 7 });
  }
  return anchor;
}

export function getNextInjectionDateTime(
  settings: GlobalSettings,
  now: DateTime = DateTime.now(),
): DateTime | null {
  const timezone = isValidTimeZone(settings.timezone)
    ? settings.timezone
    : 'UTC';
  const intervalDays = Number(settings.interval_days) || 7;
  if (intervalDays <= 0) return null;

  const zonedNow = now.setZone(timezone);
  const anchorSource = settings.start_time;
  if (!anchorSource) return null;
  const anchor = DateTime.fromISO(String(anchorSource), { zone: timezone });

  if (!anchor || !anchor.isValid) return null;

  let candidate = anchor;
  if (candidate <= zonedNow) {
    const diffHours = zonedNow.diff(candidate, 'hours').hours;
    const intervalsPassed = Math.ceil(diffHours / (intervalDays * 24));
    candidate = candidate.plus({ days: intervalDays * intervalsPassed });
  }
  return candidate;
}

export function getNextFromAnchor(
  anchorIso: string,
  intervalDays: number,
  timezone: string,
  now: DateTime = DateTime.now(),
): DateTime | null {
  if (!anchorIso || intervalDays <= 0) return null;
  const zone = isValidTimeZone(timezone) ? timezone : 'UTC';
  const anchor = DateTime.fromISO(anchorIso, { zone });
  if (!anchor.isValid) return null;
  const zonedNow = now.setZone(zone);
  let candidate = anchor;
  if (candidate <= zonedNow) {
    const diffHours = zonedNow.diff(candidate, 'hours').hours;
    const intervalsPassed = Math.ceil(diffHours / (intervalDays * 24));
    candidate = candidate.plus({ days: intervalDays * intervalsPassed });
  }
  return candidate;
}

function toCronDayFromLuxonWeekday(weekday: number): number {
  // Convert Luxon weekday (1-7, Mon-Sun) to cron day (0-6, Sun-Sat)
  return weekday % 7;
}

export function describeTimeUntil(
  target: DateTime,
  from: DateTime = DateTime.now(),
) {
  const diff = target.diff(from, ['days', 'hours', 'minutes', 'seconds']);
  const days = Math.floor(diff.days);
  const hours = Math.floor(diff.hours) % 24;
  const minutes = Math.floor(diff.minutes) % 60;
  const seconds = Math.floor(diff.seconds) % 60;
  return { days, hours, minutes, seconds };
}

export function formatDateTimeForDisplay(
  date: DateTime | string | Date,
  locale: string,
  timezone?: string,
): string {
  const dt =
    date instanceof Date
      ? DateTime.fromJSDate(date)
      : typeof date === 'string'
        ? DateTime.fromISO(date, { zone: timezone })
        : date;
  const zoned = timezone ? dt.setZone(timezone) : dt;
  return zoned
    .setLocale(locale || 'en-US')
    .toLocaleString(DateTime.DATETIME_FULL);
}

export function cronDayFromDateTime(date: DateTime): number {
  return toCronDayFromLuxonWeekday(date.weekday);
}

export function formatTimestampForDisplay(
  value: string | Date | DateTime,
  locale: string,
  timezone?: string,
): string {
  const dt =
    value instanceof Date
      ? DateTime.fromJSDate(value)
      : DateTime.isDateTime(value)
        ? value
        : DateTime.fromISO(value, { zone: timezone });
  if (!dt.isValid) return String(value);
  return dt
    .setZone(timezone || 'UTC')
    .setLocale(locale || 'en-US')
    .toLocaleString(DateTime.DATETIME_FULL);
}
