import { DateTime } from 'luxon';
import {
  isValidTimeZone,
  getAnchorDateTime,
  getNextInjectionDateTime,
  getNextFromAnchor,
  describeTimeUntil,
  cronDayFromDateTime,
} from '../src/time';
import type { GlobalSettings } from '../src/database';

describe('isValidTimeZone', () => {
  it('accepts known IANA zones', () => {
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('America/New_York')).toBe(true);
  });

  it('rejects unknown or empty zones', () => {
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('getAnchorDateTime', () => {
  const now = DateTime.fromISO('2026-08-04T10:00:00', { zone: 'utc' }); // Tuesday

  it('rolls forward to the next occurrence of the target weekday', () => {
    // injection_day 3 = Wednesday
    const anchor = getAnchorDateTime(3, '09:00', 'UTC', now);
    expect(anchor?.toISO()).toBe('2026-08-05T09:00:00.000Z');
  });

  it('advances a full week when the target time today has already passed', () => {
    // injection_day 2 = Tuesday, same day as `now`, but 09:00 is before the 10:00 "now"
    const anchor = getAnchorDateTime(2, '09:00', 'UTC', now);
    expect(anchor?.toISO()).toBe('2026-08-11T09:00:00.000Z');
  });

  it('returns null for an invalid timezone', () => {
    expect(getAnchorDateTime(3, '09:00', 'Not/AZone', now)).toBeNull();
  });

  it('returns null for an invalid time string', () => {
    expect(getAnchorDateTime(3, '25:99', 'UTC', now)).toBeNull();
  });
});

describe('getNextInjectionDateTime', () => {
  const now = DateTime.fromISO('2026-08-04T10:00:00', { zone: 'utc' });
  const baseSettings: GlobalSettings = {
    id: 1,
    injection_day: 3,
    injection_time: '09:00',
    timezone: 'UTC',
    interval_days: 7,
    start_time: '2026-07-01T09:00:00.000Z',
    medication: null,
    dose_mg: null,
    test_start_time: null,
    test_interval_days: null,
    test_timezone: null,
    last_run_at: null,
    test_last_run_at: null,
  };

  it('advances a past anchor by whole intervals to land after now', () => {
    const next = getNextInjectionDateTime(baseSettings, now);
    expect(next?.toISO()).toBe('2026-08-05T09:00:00.000Z');
  });

  it('respects a different interval', () => {
    const next = getNextInjectionDateTime(
      { ...baseSettings, interval_days: 10 },
      now,
    );
    expect(next?.toISO()).toBe('2026-08-10T09:00:00.000Z');
  });

  it('returns null when start_time is missing', () => {
    const next = getNextInjectionDateTime(
      { ...baseSettings, start_time: null },
      now,
    );
    expect(next).toBeNull();
  });
});

describe('getNextFromAnchor', () => {
  const now = DateTime.fromISO('2026-08-04T10:00:00', { zone: 'utc' });

  it('matches getNextInjectionDateTime for an equivalent anchor/interval', () => {
    const next = getNextFromAnchor('2026-07-01T09:00:00.000Z', 7, 'UTC', now);
    expect(next?.toISO()).toBe('2026-08-05T09:00:00.000Z');
  });

  it('returns null for a non-positive interval', () => {
    expect(
      getNextFromAnchor('2026-07-01T09:00:00.000Z', 0, 'UTC', now),
    ).toBeNull();
  });
});

describe('describeTimeUntil', () => {
  it('breaks a duration down into days/hours/minutes/seconds', () => {
    const from = DateTime.fromISO('2026-08-04T10:00:00', { zone: 'utc' });
    const target = from.plus({ days: 1, hours: 2, minutes: 3, seconds: 4 });
    expect(describeTimeUntil(target, from)).toEqual({
      days: 1,
      hours: 2,
      minutes: 3,
      seconds: 4,
    });
  });
});

describe('cronDayFromDateTime', () => {
  it('maps Tuesday to cron day 2', () => {
    const tuesday = DateTime.fromISO('2026-08-04T10:00:00', { zone: 'utc' });
    expect(cronDayFromDateTime(tuesday)).toBe(2);
  });

  it('maps Sunday to cron day 0', () => {
    const sunday = DateTime.fromISO('2026-08-02T10:00:00', { zone: 'utc' });
    expect(cronDayFromDateTime(sunday)).toBe(0);
  });
});
