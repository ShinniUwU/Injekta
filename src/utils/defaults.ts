import { getUserSchedule } from '../database';
import { isValidTimeZone } from '../time';

// Timezone, medication and dose from the user's schedule, if they have one.
export async function getUserDefaults(guildId: string, userId: string) {
  const schedule = await getUserSchedule(guildId, userId);
  const timezone = schedule?.timezone ?? 'UTC';
  return {
    timezone: isValidTimeZone(timezone) ? timezone : 'UTC',
    medication: schedule?.medication ?? null,
    dose_mg: schedule?.dose_mg ?? null,
  };
}
