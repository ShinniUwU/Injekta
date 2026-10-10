// src/database.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool, types } from 'pg';
import type { PoolClient, QueryResult } from 'pg';
import { DateTime } from 'luxon';
import { config } from './config';
import logger from './logger';
import { formatTimestampForDisplay } from './time';

// --- Interfaces ---
export type Leg = 'Right' | 'Left';
export type RemindVia = 'dm' | 'channel';

export interface InjectionRecord {
  id: number;
  guild_id: string | null;
  user_id: string;
  leg: Leg;
  injection_date: string; // TIMESTAMPTZ as ISO string from pg
  performed_at: string;
  medication: string | null;
  dose_mg: number | null;
  raw_units: number | null;
  created_by_admin_id: string | null;
  created_at: string;
}

export interface GuildSettings {
  guild_id: string;
  channel_id: string | null;
  test_start_time: string | null;
  test_interval_days: number | null;
  test_timezone: string | null;
  test_last_run_at: string | null;
}

export interface UserSchedule {
  guild_id: string;
  user_id: string;
  start_time: string;
  interval_days: number;
  timezone: string;
  medication: string | null;
  dose_mg: number | null;
  last_run_at: string | null;
}

export interface UserSettings {
  guild_id: string;
  user_id: string;
  share_with_admins: boolean;
  remind_via: RemindVia;
}

// pg returns TIMESTAMPTZ as Date and NUMERIC as string by default, which doesn't
// match the interfaces above. Normalize to ISO strings and numbers.
const toIsoString = (value: string) => {
  const dt = DateTime.fromSQL(value, { setZone: true });
  return dt.isValid ? (dt.toUTC().toISO() as string) : value;
};
types.setTypeParser(types.builtins.TIMESTAMPTZ, toIsoString);
types.setTypeParser(types.builtins.TIMESTAMP, toIsoString);
types.setTypeParser(types.builtins.NUMERIC, (value: string) =>
  parseFloat(value),
);

// --- Database Connection Pool ---
let pool: Pool;
try {
  pool = new Pool({
    connectionString: config.databaseUrl,
    statement_timeout: 10000,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });
  pool.on('error', (err) => {
    logger.error('Unexpected error on idle PostgreSQL client', {
      pgError: err,
    });
    process.exit(-1);
  });
  logger.info('PostgreSQL Pool initialized successfully.');
} catch (error) {
  logger.error(
    'Failed to initialize PostgreSQL Pool. Check DATABASE_URL and database status.',
    { initError: error },
  );
  process.exit(1);
}

async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

// --- Schema / migrations ---

// Applies schema.sql (idempotent) and moves data from the single-server layout
// (global_settings + injections without guild_id) into the per-server tables.
export async function migrate(): Promise<void> {
  const schemaPath = join(import.meta.dir, '..', 'schema.sql');
  await pool.query(readFileSync(schemaPath, 'utf-8'));

  const legacyGuildId = config.guildId;
  if (!legacyGuildId) {
    const orphaned = await pool.query(
      'SELECT 1 FROM injections WHERE guild_id IS NULL LIMIT 1',
    );
    if (orphaned.rowCount) {
      logger.warn(
        'Some injection logs have no server attached. Set GUILD_ID once so they can be moved to that server.',
      );
    }
    return;
  }

  await withTransaction(async (client) => {
    const moved = await client.query(
      'UPDATE injections SET guild_id = $1 WHERE guild_id IS NULL',
      [legacyGuildId],
    );
    await client.query(
      'UPDATE admin_actions SET guild_id = $1 WHERE guild_id IS NULL',
      [legacyGuildId],
    );
    if (moved.rowCount) {
      logger.info(
        `Moved ${moved.rowCount} legacy log(s) to server ${legacyGuildId}.`,
      );
    }

    const legacyTable = await client.query(
      "SELECT to_regclass('public.global_settings') AS t",
    );
    if (legacyTable.rows[0]?.t) {
      await client.query(
        `INSERT INTO guild_settings (guild_id, channel_id, test_start_time, test_interval_days,
           test_timezone, test_last_run_at)
         SELECT $1, $2, test_start_time, test_interval_days, test_timezone, test_last_run_at
         FROM global_settings WHERE id = 1
         ON CONFLICT (guild_id) DO NOTHING`,
        [legacyGuildId, config.designatedChannelId || null],
      );
      // The old server-wide schedule only ever reminded the bot owner, so it
      // becomes the owner's personal schedule.
      if (config.botOwnerId) {
        const converted = await client.query(
          `INSERT INTO user_schedules (guild_id, user_id, start_time, interval_days, timezone,
             medication, dose_mg, last_run_at)
           SELECT $1, $2, start_time, interval_days, timezone, medication, dose_mg, last_run_at
           FROM global_settings WHERE id = 1 AND start_time IS NOT NULL
           ON CONFLICT (guild_id, user_id) DO NOTHING`,
          [legacyGuildId, config.botOwnerId],
        );
        if (converted.rowCount) {
          logger.info(
            'Moved the old server schedule to the owner as a personal schedule.',
          );
        }
      } else {
        logger.warn(
          'Old server schedule found but BOT_OWNER_ID is not set, so it was not moved. Members need /myschedule set.',
        );
      }
    }

    if (config.designatedChannelId) {
      await client.query(
        `INSERT INTO guild_settings (guild_id, channel_id) VALUES ($1, $2)
         ON CONFLICT (guild_id) DO UPDATE SET channel_id = COALESCE(guild_settings.channel_id, EXCLUDED.channel_id)`,
        [legacyGuildId, config.designatedChannelId],
      );
    }
  });
}

// --- Injection logs ---

const RECORD_COLUMNS =
  'id, guild_id, user_id, leg, injection_date, performed_at, medication, dose_mg, raw_units, created_by_admin_id, created_at';

export async function getLastRecord(
  guildId: string,
  userId: string,
): Promise<InjectionRecord | null> {
  try {
    const result: QueryResult<InjectionRecord> = await pool.query(
      `SELECT ${RECORD_COLUMNS} FROM injections WHERE guild_id = $1 AND user_id = $2
       ORDER BY performed_at DESC, created_at DESC LIMIT 1`,
      [guildId, userId],
    );
    return result.rows[0] || null;
  } catch (error) {
    logger.error('PostgreSQL error fetching last record', {
      guildId,
      userId,
      pgError: error,
    });
    return null;
  }
}

export async function getRecentLogs(
  guildId: string,
  userId: string,
  limit = 5,
): Promise<InjectionRecord[]> {
  try {
    const result: QueryResult<InjectionRecord> = await pool.query(
      `SELECT ${RECORD_COLUMNS} FROM injections WHERE guild_id = $1 AND user_id = $2
       ORDER BY performed_at DESC, created_at DESC LIMIT $3`,
      [guildId, userId, limit],
    );
    return result.rows;
  } catch (error) {
    logger.error('PostgreSQL error fetching recent logs', {
      guildId,
      userId,
      pgError: error,
    });
    return [];
  }
}

export async function getAllUserRecords(
  guildId: string,
  userId: string,
): Promise<InjectionRecord[]> {
  try {
    const result: QueryResult<InjectionRecord> = await pool.query(
      `SELECT ${RECORD_COLUMNS} FROM injections WHERE guild_id = $1 AND user_id = $2
       ORDER BY performed_at ASC, created_at ASC`,
      [guildId, userId],
    );
    return result.rows;
  } catch (error) {
    logger.error('PostgreSQL error fetching all user records', {
      guildId,
      userId,
      pgError: error,
    });
    return [];
  }
}

export async function enforceMaxFiveRecords(
  guildId: string,
  userId: string,
): Promise<void> {
  const maxRecords = 5;
  try {
    // Keep the 5 most recent injections by when they happened, not when they were logged.
    const deleteResult = await pool.query(
      `DELETE FROM injections WHERE guild_id = $1 AND user_id = $2 AND id NOT IN (
         SELECT id FROM injections WHERE guild_id = $1 AND user_id = $2
         ORDER BY performed_at DESC, created_at DESC, id DESC LIMIT $3)`,
      [guildId, userId, maxRecords],
    );
    if (deleteResult.rowCount) {
      logger.info(
        `Deleted ${deleteResult.rowCount} old record(s) for user ${userId} to maintain max ${maxRecords}.`,
      );
    }
  } catch (error) {
    logger.error('PostgreSQL error enforcing max records', {
      guildId,
      userId,
      pgError: error,
    });
  }
}

export function getNextLeg(lastLeg?: string | null): Leg {
  return lastLeg === 'Right' ? 'Left' : 'Right';
}

// Most recent injection at or before `before`, so backdated logs alternate
// against the injection that actually came before them.
async function getRecordBefore(
  guildId: string,
  userId: string,
  before: Date,
): Promise<InjectionRecord | null> {
  const result: QueryResult<InjectionRecord> = await pool.query(
    `SELECT ${RECORD_COLUMNS} FROM injections
     WHERE guild_id = $1 AND user_id = $2 AND performed_at <= $3
     ORDER BY performed_at DESC, created_at DESC LIMIT 1`,
    [guildId, userId, before],
  );
  return result.rows[0] || null;
}

export async function suggestNextLeg(
  guildId: string,
  userId: string,
  performedAt: Date = new Date(),
): Promise<Leg> {
  try {
    return getNextLeg(
      (await getRecordBefore(guildId, userId, performedAt))?.leg,
    );
  } catch (error) {
    logger.error('PostgreSQL error suggesting next leg', {
      userId,
      pgError: error,
    });
    return getNextLeg(null);
  }
}

export async function createInjectionRecord(
  guildId: string,
  userId: string,
  options?: {
    medication?: string | null;
    doseMg?: number | null;
    performedAt?: string | Date | null;
    rawUnits?: number | null;
    adminUserId?: string | null;
    leg?: Leg | null;
  },
): Promise<{
  id: number;
  leg: Leg;
  date: string;
  medication: string | null;
  dose_mg: number | null;
  performed_at: string;
  raw_units: number | null;
} | null> {
  try {
    const parsedDose =
      options?.doseMg === null || options?.doseMg === undefined
        ? null
        : Number(options.doseMg);
    const doseValue = Number.isFinite(parsedDose) ? parsedDose : null;
    const rawUnits =
      options?.rawUnits === null || options?.rawUnits === undefined
        ? null
        : Number(options.rawUnits);
    const rawUnitsValue =
      rawUnits !== null && Number.isFinite(rawUnits) && rawUnits >= 0
        ? Math.floor(rawUnits)
        : null;

    let performedAtValue: Date;
    if (options?.performedAt instanceof Date) {
      performedAtValue = options.performedAt;
    } else if (typeof options?.performedAt === 'string') {
      const parsed = new Date(options.performedAt);
      performedAtValue = isNaN(parsed.getTime()) ? new Date() : parsed;
    } else {
      performedAtValue = new Date();
    }

    const nextLeg =
      options?.leg ??
      getNextLeg(
        (await getRecordBefore(guildId, userId, performedAtValue))?.leg,
      );

    const result = await pool.query(
      `INSERT INTO injections (guild_id, user_id, leg, injection_date, performed_at, medication, dose_mg, raw_units, created_by_admin_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, leg, injection_date, performed_at, medication, dose_mg, raw_units`,
      [
        guildId,
        userId,
        nextLeg,
        performedAtValue,
        performedAtValue,
        options?.medication ?? null,
        doseValue,
        rawUnitsValue,
        options?.adminUserId ?? null,
      ],
    );
    if (result.rowCount !== 1) {
      logger.error('PostgreSQL error inserting new record: No rows returned', {
        userId,
      });
      return null;
    }
    await enforceMaxFiveRecords(guildId, userId);
    const row = result.rows[0];
    return {
      id: row.id,
      leg: row.leg,
      date: formatTimestampForDisplay(row.performed_at, 'en-US'),
      medication: row.medication,
      dose_mg: row.dose_mg,
      performed_at: row.performed_at,
      raw_units: row.raw_units,
    };
  } catch (error) {
    logger.error('PostgreSQL error creating injection record', {
      userId,
      pgError: error,
    });
    return null;
  }
}

export async function getLogById(
  logId: number,
): Promise<InjectionRecord | null> {
  try {
    const result = await pool.query<InjectionRecord>(
      `SELECT ${RECORD_COLUMNS} FROM injections WHERE id = $1`,
      [logId],
    );
    return result.rows[0] || null;
  } catch (error) {
    logger.error('PostgreSQL error fetching log by ID', {
      logId,
      pgError: error,
    });
    return null;
  }
}

export async function updateLog(
  logId: number,
  fields: {
    leg?: Leg;
    performedAt?: Date;
    medication?: string | null;
    doseMg?: number | null;
    rawUnits?: number | null;
  },
): Promise<InjectionRecord | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  if (fields.leg !== undefined) add('leg', fields.leg);
  if (fields.performedAt !== undefined) {
    add('performed_at', fields.performedAt);
    add('injection_date', fields.performedAt);
  }
  if (fields.medication !== undefined) add('medication', fields.medication);
  if (fields.doseMg !== undefined) add('dose_mg', fields.doseMg);
  if (fields.rawUnits !== undefined) add('raw_units', fields.rawUnits);
  if (sets.length === 0) return getLogById(logId);

  values.push(logId);
  try {
    const result = await pool.query<InjectionRecord>(
      `UPDATE injections SET ${sets.join(', ')} WHERE id = $${
        values.length
      } RETURNING ${RECORD_COLUMNS}`,
      values,
    );
    return result.rows[0] || null;
  } catch (error) {
    logger.error('PostgreSQL error updating log', { logId, pgError: error });
    return null;
  }
}

// Deletes a log only if it belongs to the given server and user.
export async function deleteLogById(
  logId: number,
  owner: { guildId: string; userId: string },
): Promise<{ success: boolean; deletedRecord?: InjectionRecord }> {
  try {
    return await withTransaction(async (client) => {
      const selectResult = await client.query<InjectionRecord>(
        `SELECT ${RECORD_COLUMNS} FROM injections WHERE id = $1 FOR UPDATE`,
        [logId],
      );
      const record = selectResult.rows[0];
      if (
        !record ||
        record.guild_id !== owner.guildId ||
        record.user_id !== owner.userId
      ) {
        logger.warn('Delete refused: log missing or owned by someone else', {
          logId,
        });
        return { success: false };
      }
      await client.query('DELETE FROM injections WHERE id = $1', [logId]);
      logger.info('Deleted log entry', { logId });
      return { success: true, deletedRecord: record };
    });
  } catch (error) {
    logger.error('PostgreSQL error deleting log by ID', {
      logId,
      pgError: error,
    });
    return { success: false };
  }
}

export async function deleteLatestLogForUser(
  guildId: string,
  userId: string,
): Promise<{ success: boolean; deletedRecord?: InjectionRecord }> {
  try {
    return await withTransaction(async (client) => {
      const findResult = await client.query<InjectionRecord>(
        `SELECT ${RECORD_COLUMNS} FROM injections WHERE guild_id = $1 AND user_id = $2
         ORDER BY performed_at DESC, created_at DESC, id DESC LIMIT 1 FOR UPDATE`,
        [guildId, userId],
      );
      const latestRecord = findResult.rows[0];
      if (!latestRecord) return { success: false };
      await client.query('DELETE FROM injections WHERE id = $1', [
        latestRecord.id,
      ]);
      logger.info('Deleted latest log entry', { logId: latestRecord.id });
      return { success: true, deletedRecord: latestRecord };
    });
  } catch (error) {
    logger.error('PostgreSQL error deleting latest log for user', {
      userId,
      pgError: error,
    });
    return { success: false };
  }
}

// Latest injection time per user in a server.
export async function getLatestInjectionTimes(
  guildId: string,
): Promise<Map<string, string>> {
  const result = await pool.query<{ user_id: string; latest: string }>(
    `SELECT user_id, MAX(performed_at) AS latest FROM injections
     WHERE guild_id = $1 GROUP BY user_id`,
    [guildId],
  );
  return new Map(result.rows.map((row) => [row.user_id, row.latest]));
}

// --- Server settings ---

const GUILD_SETTING_COLUMNS = [
  'channel_id',
  'test_start_time',
  'test_interval_days',
  'test_timezone',
  'test_last_run_at',
] as const;

export async function getGuildSettings(
  guildId: string,
): Promise<GuildSettings | null> {
  try {
    const result = await pool.query<GuildSettings>(
      'SELECT * FROM guild_settings WHERE guild_id = $1',
      [guildId],
    );
    return result.rows[0] || null;
  } catch (error) {
    logger.error('PostgreSQL error fetching server settings', {
      guildId,
      pgError: error,
    });
    return null;
  }
}

export async function getAllGuildSettings(): Promise<GuildSettings[]> {
  const result = await pool.query<GuildSettings>(
    'SELECT * FROM guild_settings',
  );
  return result.rows;
}

// Inserts or updates only the given columns.
export async function updateGuildSettings(
  guildId: string,
  fields: Partial<Omit<GuildSettings, 'guild_id'>>,
): Promise<boolean> {
  const columns = GUILD_SETTING_COLUMNS.filter(
    (column) => fields[column] !== undefined,
  );
  if (columns.length === 0) return true;
  const values = columns.map((column) => fields[column]);
  const placeholders = columns.map((_, index) => `$${index + 2}`);
  try {
    await pool.query(
      `INSERT INTO guild_settings (guild_id, ${columns.join(', ')})
       VALUES ($1, ${placeholders.join(', ')})
       ON CONFLICT (guild_id) DO UPDATE SET ${columns
         .map((column) => `${column} = EXCLUDED.${column}`)
         .join(', ')}`,
      [guildId, ...values],
    );
    return true;
  } catch (error) {
    logger.error('PostgreSQL error updating server settings', {
      guildId,
      pgError: error,
    });
    return false;
  }
}

// --- Personal schedules ---

export async function getUserSchedule(
  guildId: string,
  userId: string,
): Promise<UserSchedule | null> {
  try {
    const result = await pool.query<UserSchedule>(
      'SELECT * FROM user_schedules WHERE guild_id = $1 AND user_id = $2',
      [guildId, userId],
    );
    return result.rows[0] || null;
  } catch (error) {
    logger.error('PostgreSQL error fetching personal schedule', {
      guildId,
      userId,
      pgError: error,
    });
    return null;
  }
}

export async function getAllUserSchedules(): Promise<UserSchedule[]> {
  const result = await pool.query<UserSchedule>('SELECT * FROM user_schedules');
  return result.rows;
}

export async function setUserSchedule(
  schedule: Omit<UserSchedule, 'last_run_at'>,
): Promise<boolean> {
  try {
    await pool.query(
      `INSERT INTO user_schedules (guild_id, user_id, start_time, interval_days, timezone, medication, dose_mg, last_run_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (guild_id, user_id) DO UPDATE SET
         start_time = EXCLUDED.start_time,
         interval_days = EXCLUDED.interval_days,
         timezone = EXCLUDED.timezone,
         medication = EXCLUDED.medication,
         dose_mg = EXCLUDED.dose_mg,
         last_run_at = NOW()`,
      [
        schedule.guild_id,
        schedule.user_id,
        schedule.start_time,
        schedule.interval_days,
        schedule.timezone,
        schedule.medication,
        schedule.dose_mg,
      ],
    );
    return true;
  } catch (error) {
    logger.error('PostgreSQL error saving personal schedule', {
      guildId: schedule.guild_id,
      userId: schedule.user_id,
      pgError: error,
    });
    return false;
  }
}

export async function deleteUserSchedule(
  guildId: string,
  userId: string,
): Promise<boolean> {
  const result = await pool.query(
    'DELETE FROM user_schedules WHERE guild_id = $1 AND user_id = $2',
    [guildId, userId],
  );
  return Boolean(result.rowCount);
}

// --- Privacy settings ---

export async function getUserSettings(
  guildId: string,
  userId: string,
): Promise<UserSettings> {
  const defaults: UserSettings = {
    guild_id: guildId,
    user_id: userId,
    share_with_admins: false,
    remind_via: 'dm',
  };
  try {
    const result = await pool.query<UserSettings>(
      'SELECT * FROM user_settings WHERE guild_id = $1 AND user_id = $2',
      [guildId, userId],
    );
    return result.rows[0] ?? defaults;
  } catch (error) {
    logger.error('PostgreSQL error fetching privacy settings', {
      guildId,
      userId,
      pgError: error,
    });
    // Fail closed: if we can't read the setting, treat the user as private.
    return defaults;
  }
}

export async function getAllUserSettings(
  guildId: string,
): Promise<Map<string, UserSettings>> {
  const result = await pool.query<UserSettings>(
    'SELECT * FROM user_settings WHERE guild_id = $1',
    [guildId],
  );
  return new Map(result.rows.map((row) => [row.user_id, row]));
}

export async function updateUserSettings(
  guildId: string,
  userId: string,
  fields: { share_with_admins?: boolean; remind_via?: RemindVia },
): Promise<UserSettings | null> {
  try {
    const result = await pool.query<UserSettings>(
      `INSERT INTO user_settings (guild_id, user_id, share_with_admins, remind_via)
       VALUES ($1, $2, COALESCE($3, FALSE), COALESCE($4, 'dm'))
       ON CONFLICT (guild_id, user_id) DO UPDATE SET
         share_with_admins = COALESCE($3, user_settings.share_with_admins),
         remind_via = COALESCE($4, user_settings.remind_via)
       RETURNING *`,
      [
        guildId,
        userId,
        fields.share_with_admins ?? null,
        fields.remind_via ?? null,
      ],
    );
    return result.rows[0] ?? null;
  } catch (error) {
    logger.error('PostgreSQL error updating privacy settings', {
      guildId,
      userId,
      pgError: error,
    });
    return null;
  }
}

// Removes everything stored about a user in one server.
export async function deleteUserData(
  guildId: string,
  userId: string,
): Promise<{ logs: number } | null> {
  try {
    return await withTransaction(async (client) => {
      const logs = await client.query(
        'DELETE FROM injections WHERE guild_id = $1 AND user_id = $2',
        [guildId, userId],
      );
      await client.query(
        'DELETE FROM user_schedules WHERE guild_id = $1 AND user_id = $2',
        [guildId, userId],
      );
      await client.query(
        'DELETE FROM user_settings WHERE guild_id = $1 AND user_id = $2',
        [guildId, userId],
      );
      // Audit entries about this user can contain dose details; drop those too.
      await client.query(
        'UPDATE admin_actions SET details = NULL WHERE guild_id = $1 AND target_user_id = $2',
        [guildId, userId],
      );
      return { logs: logs.rowCount ?? 0 };
    });
  } catch (error) {
    logger.error('PostgreSQL error deleting user data', {
      guildId,
      userId,
      pgError: error,
    });
    return null;
  }
}

// Everything stored about one user in one server, for /exportmydata.
// Other people's IDs (e.g. which admin logged an entry) are left out.
export async function exportUserData(guildId: string, userId: string) {
  const [logs, schedule, settings, adminActions] = await Promise.all([
    pool.query(
      `SELECT id, leg, performed_at, medication, dose_mg, raw_units,
         (created_by_admin_id IS NOT NULL) AS logged_by_admin, created_at
       FROM injections WHERE guild_id = $1 AND user_id = $2
       ORDER BY performed_at DESC`,
      [guildId, userId],
    ),
    getUserSchedule(guildId, userId),
    getUserSettings(guildId, userId),
    pool.query(
      `SELECT action, log_id, details, created_at FROM admin_actions
       WHERE guild_id = $1 AND target_user_id = $2 ORDER BY created_at DESC`,
      [guildId, userId],
    ),
  ]);
  return {
    logs: logs.rows,
    schedule: schedule
      ? {
          start_time: schedule.start_time,
          interval_days: schedule.interval_days,
          timezone: schedule.timezone,
          medication: schedule.medication,
          dose_mg: schedule.dose_mg,
        }
      : null,
    privacy: {
      share_with_admins: settings.share_with_admins,
      remind_via: settings.remind_via,
    },
    admin_actions_on_your_logs: adminActions.rows,
  };
}

// --- Admin actions audit ---
export async function recordAdminAction(params: {
  guildId: string;
  adminUserId: string;
  targetUserId?: string;
  action: string;
  logId?: number;
  details?: string;
}) {
  try {
    await pool.query(
      `INSERT INTO admin_actions (guild_id, admin_user_id, target_user_id, action, log_id, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.guildId,
        params.adminUserId,
        params.targetUserId ?? null,
        params.action,
        params.logId ?? null,
        params.details ?? null,
      ],
    );
  } catch (error) {
    logger.error('Failed to record admin action', {
      action: params.action,
      pgError: error,
    });
  }
}

// --- Scheduler bookkeeping ---

export async function updateTestRunTime(
  guildId: string,
  testLastRunAt: string,
) {
  try {
    await pool.query(
      'UPDATE guild_settings SET test_last_run_at = $2 WHERE guild_id = $1',
      [guildId, testLastRunAt],
    );
  } catch (error) {
    logger.error('Failed to update test reminder run time', { pgError: error });
  }
}

export async function updateUserRunTime(
  guildId: string,
  userId: string,
  lastRunAt: string,
) {
  try {
    await pool.query(
      'UPDATE user_schedules SET last_run_at = $3 WHERE guild_id = $1 AND user_id = $2',
      [guildId, userId, lastRunAt],
    );
  } catch (error) {
    logger.error('Failed to update personal run time', { pgError: error });
  }
}

export async function closeDbPool() {
  logger.info('Closing PostgreSQL connection pool...');
  await pool.end();
  logger.info('PostgreSQL pool closed.');
}

// --- Health checks ---
export async function pingDatabase(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (error) {
    logger.error('Database ping failed', { pgError: error });
    return false;
  }
}
