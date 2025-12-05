import { DateTime } from 'luxon';
import {
  describeTimeUntil,
  getNextInjectionDateTime,
  isValidTimeZone,
} from '../src/time';
import type { GlobalSettings } from '../src/database';

describe('time utilities', () => {
  test('validates IANA timezones', () => {
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
  });

  test('computes next injection on same day if time has not passed', () => {
    const settings: GlobalSettings = {
      id: 1,
      injection_day: 1, // Monday
      injection_time: '10:00',
      timezone: 'UTC',
      interval_days: 7,
      start_time: '2024-01-01T10:00:00Z',
      medication: null,
      dose_mg: null,
    };
    const now = DateTime.fromISO('2024-01-01T09:00:00', { zone: 'UTC' }); // Monday 9 AM
    const next = getNextInjectionDateTime(settings, now);
    expect(next?.weekday).toBe(1); // Monday
    expect(next?.hour).toBe(10);
  });

  test('computes next injection for following week when time passed', () => {
    const settings: GlobalSettings = {
      id: 1,
      injection_day: 1, // Monday
      injection_time: '10:00',
      timezone: 'UTC',
      interval_days: 7,
      start_time: '2024-01-01T10:00:00Z',
      medication: null,
      dose_mg: null,
    };
    const now = DateTime.fromISO('2024-01-01T11:00:00', { zone: 'UTC' }); // Monday 11 AM
    const next = getNextInjectionDateTime(settings, now);
    expect(next?.weekday).toBe(1);
    expect(next?.diff(now, 'days').days).toBeGreaterThan(6.9);
  });

  test('supports fractional intervals (e.g., every 3.5 days)', () => {
    const settings: GlobalSettings = {
      id: 1,
      injection_day: 1,
      injection_time: '10:00',
      timezone: 'UTC',
      interval_days: 3.5,
      start_time: '2024-01-01T10:00:00Z',
      medication: null,
      dose_mg: null,
    };
    const now = DateTime.fromISO('2024-01-02T10:00:00', { zone: 'UTC' }); // 1 day later
    const next = getNextInjectionDateTime(settings, now);
    expect(next?.toISO()).toBe('2024-01-04T22:00:00.000Z');
  });

  test('describes time until target', () => {
    const from = DateTime.fromISO('2024-01-01T00:00:00', { zone: 'UTC' });
    const target = from.plus({ days: 1, hours: 2, minutes: 3, seconds: 4 });
    const diff = describeTimeUntil(target, from);
    expect(diff.days).toBe(1);
    expect(diff.hours).toBe(2);
    expect(diff.minutes).toBe(3);
    expect(diff.seconds).toBe(4);
  });
});
