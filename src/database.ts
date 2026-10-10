// src/database.ts
import { Pool, types } from 'pg';
import type { PoolClient, QueryResult } from 'pg';
import { DateTime } from 'luxon';
import { config } from './config';
import logger from './logger';
import { formatTimestampForDisplay } from './time';

// --- Interfaces ---
export interface InjectionRecord {
  id: number;
  user_id: string;
  leg: 'Right' | 'Left';
  injection_date: string; // TIMESTAMPTZ as ISO string from pg
  performed_at: string;
  medication: string | null;
  dose_mg: number | string | null;
  raw_units: number | null;
  created_by_admin_id: string | null;
  created_at: string;
}

export interface GlobalSettings {
  id: number;
  injection_day: number;
  injection_time: string;
  timezone: string;
  interval_days: number;
  start_time: string | null;
  medication: string | null;
  dose_mg: number | null;
  test_start_time: string | null;
  test_interval_days: number | null;
  test_timezone: string | null;
  last_run_at: string | null;
  test_last_run_at: string | null;
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

// --- Database Functions ---

export async function getLastRecord(
  userId?: string,
): Promise<InjectionRecord | null> {
  const baseQuery =
    'SELECT id, user_id, leg, injection_date, performed_at, medication, dose_mg, raw_units, created_by_admin_id, created_at FROM injections';
  const params: string[] = [];
  let queryText = baseQuery;
  if (userId) {
    queryText +=
      ' WHERE user_id = $1 ORDER BY performed_at DESC, created_at DESC LIMIT 1';
    params.push(userId);
  } else {
    queryText += ' ORDER BY performed_at DESC, created_at DESC LIMIT 1';
  }
  try {
    const result: QueryResult<InjectionRecord> = await pool.query(
      queryText,
      params,
    );
    return result.rows[0] || null;
  } catch (error) {
    logger.error('PostgreSQL error fetching last record', {
      userId,
      pgError: error,
    });
    return null;
  }
}

// Ensure this function is exported correctly
export async function getRecentLogs(
  userId: string,
  limit = 5,
): Promise<InjectionRecord[]> {
  const queryText = `
        SELECT id, user_id, leg, injection_date, performed_at, medication, dose_mg, raw_units, created_by_admin_id, created_at
        FROM injections WHERE user_id = $1 ORDER BY performed_at DESC, created_at DESC LIMIT $2`;
  try {
    const result: QueryResult<InjectionRecord> = await pool.query(queryText, [
      userId,
      limit,
    ]);
    return result.rows;
  } catch (error) {
    logger.error('PostgreSQL error fetching recent logs', {
      userId,
      limit,
      pgError: error,
    });
    return [];
  }
}

export async function getAllUserRecords(
  userId: string,
): Promise<InjectionRecord[]> {
  const queryText = `
        SELECT id, user_id, leg, injection_date, performed_at, medication, dose_mg, raw_units, created_by_admin_id, created_at
        FROM injections WHERE user_id = $1 ORDER BY performed_at ASC, created_at ASC`;
  try {
    const result: QueryResult<InjectionRecord> = await pool.query(queryText, [
      userId,
    ]);
    return result.rows;
  } catch (error) {
    logger.error('PostgreSQL error fetching all user records', {
      userId,
      pgError: error,
    });
    return [];
  }
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

export async function enforceMaxFiveRecords(userId: string): Promise<void> {
  const maxRecords = 5;
  try {
    // Keep the 5 most recent injections by when they happened, not when they were logged.
    const deleteResult = await pool.query(
      `DELETE FROM injections WHERE user_id = $1 AND id NOT IN (
         SELECT id FROM injections WHERE user_id = $1
         ORDER BY performed_at DESC, created_at DESC, id DESC LIMIT $2)`,
      [userId, maxRecords],
    );
    if (deleteResult.rowCount) {
      logger.info(
        `Deleted ${deleteResult.rowCount} old record(s) for user ${userId} to maintain max ${maxRecords}.`,
      );
    }
  } catch (error) {
    logger.error('PostgreSQL error enforcing max records', {
      userId,
      pgError: error,
    });
  }
}

export function getNextLeg(lastLeg?: string | null): 'Right' | 'Left' {
  return lastLeg === 'Right' ? 'Left' : 'Right';
}

// Most recent injection at or before `before`, so backdated logs alternate
// against the injection that actually came before them.
async function getRecordBefore(
  userId: string,
  before: Date,
): Promise<InjectionRecord | null> {
  const result: QueryResult<InjectionRecord> = await pool.query(
    `SELECT * FROM injections WHERE user_id = $1 AND performed_at <= $2
     ORDER BY performed_at DESC, created_at DESC LIMIT 1`,
    [userId, before],
  );
  return result.rows[0] || null;
}

export async function suggestNextLeg(
  userId: string,
  performedAt: Date = new Date(),
): Promise<'Right' | 'Left'> {
  try {
    return getNextLeg((await getRecordBefore(userId, performedAt))?.leg);
  } catch (error) {
    logger.error('PostgreSQL error suggesting next leg', {
      userId,
      pgError: error,
    });
    return getNextLeg(null);
  }
}

export async function createInjectionRecord(
  userId: string,
  options?: {
    medication?: string | null;
    doseMg?: number | null;
    performedAt?: string | Date | null;
    rawUnits?: number | null;
    adminUserId?: string | null;
    leg?: 'Right' | 'Left' | null;
  },
): Promise<{
  id: number;
  leg: 'Right' | 'Left';
  date: string;
  medication: string | null;
  dose_mg: number | string | null;
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
      getNextLeg((await getRecordBefore(userId, performedAtValue))?.leg);

    const insertQuery = `
            INSERT INTO injections (user_id, leg, injection_date, performed_at, medication, dose_mg, raw_units, created_by_admin_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id, leg, injection_date, performed_at, medication, dose_mg, raw_units`;
    const params = [
      userId,
      nextLeg,
      performedAtValue,
      performedAtValue,
      options?.medication ?? null,
      doseValue,
      rawUnitsValue,
      options?.adminUserId ?? null,
    ];
    const result = await pool.query(insertQuery, params);
    if (result.rowCount === 1) {
      await enforceMaxFiveRecords(userId);
      const formattedDate = formatTimestampForDisplay(
        result.rows[0].performed_at,
        'en-US',
      );
      return {
        id: result.rows[0].id,
        leg: result.rows[0].leg,
        date: formattedDate,
        medication: result.rows[0].medication,
        dose_mg: result.rows[0].dose_mg,
        performed_at: result.rows[0].performed_at,
        raw_units: result.rows[0].raw_units,
      };
    } else {
      logger.error('PostgreSQL error inserting new record: No rows returned', {
        userId,
      });
      return null;
    }
  } catch (error) {
    logger.error('PostgreSQL error creating injection record', {
      userId,
      pgError: error,
    });
    return null;
  }
}

export async function getGlobalSettings(): Promise<GlobalSettings | null> {
  const queryText =
    'SELECT id, injection_day, injection_time, timezone, interval_days, start_time, medication, dose_mg, test_start_time, test_interval_days, test_timezone, last_run_at, test_last_run_at FROM global_settings WHERE id = 1 LIMIT 1';
  try {
    const result: QueryResult<GlobalSettings> = await pool.query(queryText);
    if (result.rows.length > 0) {
      return result.rows[0];
    } else {
      logger.warn('Global settings row (id=1) not found in database.');
      return null;
    }
  } catch (error) {
    logger.error('PostgreSQL error fetching global settings', {
      pgError: error,
    });
    return null;
  }
}

export async function setGlobalSettings(
  settings: Omit<GlobalSettings, 'id'>,
): Promise<boolean> {
  const queryText = `
        INSERT INTO global_settings (id, injection_day, injection_time, timezone, interval_days, start_time, medication, dose_mg, test_start_time, test_interval_days, test_timezone, last_run_at, test_last_run_at)
        VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO UPDATE SET
            injection_day = EXCLUDED.injection_day,
            injection_time = EXCLUDED.injection_time,
            timezone = EXCLUDED.timezone,
            interval_days = EXCLUDED.interval_days,
            start_time = EXCLUDED.start_time,
            medication = EXCLUDED.medication,
            dose_mg = EXCLUDED.dose_mg,
            test_start_time = EXCLUDED.test_start_time,
            test_interval_days = EXCLUDED.test_interval_days,
            test_timezone = EXCLUDED.test_timezone,
            last_run_at = EXCLUDED.last_run_at,
            test_last_run_at = EXCLUDED.test_last_run_at`;
  const params = [
    settings.injection_day,
    settings.injection_time,
    settings.timezone,
    settings.interval_days,
    settings.start_time,
    settings.medication,
    settings.dose_mg,
    settings.test_start_time,
    settings.test_interval_days,
    settings.test_timezone,
    settings.last_run_at,
    settings.test_last_run_at,
  ];
  try {
    const result = await pool.query(queryText, params);
    return result.rowCount === 1;
  } catch (error) {
    logger.error('PostgreSQL error setting global settings', {
      pgError: error,
    });
    return false;
  }
}

// --- NEW Deletion Functions ---

export async function deleteLogById(
  logId: number,
  userIdToCheck?: string,
): Promise<{ success: boolean; deletedRecord?: InjectionRecord }> {
  try {
    return await withTransaction(async (client) => {
      const selectResult = await client.query<InjectionRecord>(
        'SELECT * FROM injections WHERE id = $1 FOR UPDATE',
        [logId],
      );
      const recordToDelete = selectResult.rows[0];
      if (!recordToDelete) {
        logger.warn('Attempted to delete non-existent log entry', {
          logId,
          userIdToCheck,
        });
        return { success: false };
      }
      if (userIdToCheck && recordToDelete.user_id !== userIdToCheck) {
        logger.warn('Attempted to delete log entry belonging to another user', {
          logId,
          requestingUser: userIdToCheck,
          ownerUser: recordToDelete.user_id,
        });
        return { success: false };
      }
      await client.query('DELETE FROM injections WHERE id = $1', [logId]);
      logger.info('Successfully deleted log entry', {
        logId,
        userId: recordToDelete.user_id,
      });
      return { success: true, deletedRecord: recordToDelete };
    });
  } catch (error) {
    logger.error('PostgreSQL error deleting log by ID', {
      logId,
      userIdToCheck,
      pgError: error,
    });
    return { success: false };
  }
}

export async function deleteLatestLogForUser(
  userId: string,
): Promise<{ success: boolean; deletedRecord?: InjectionRecord }> {
  try {
    return await withTransaction(async (client) => {
      const findResult = await client.query<InjectionRecord>(
        `SELECT * FROM injections WHERE user_id = $1
         ORDER BY performed_at DESC, created_at DESC, id DESC LIMIT 1 FOR UPDATE`,
        [userId],
      );
      const latestRecord = findResult.rows[0];
      if (!latestRecord) {
        logger.info('No logs found to delete for user', { userId });
        return { success: false };
      }
      await client.query('DELETE FROM injections WHERE id = $1', [
        latestRecord.id,
      ]);
      logger.info('Successfully deleted latest log entry for user', {
        userId,
        deletedLogId: latestRecord.id,
      });
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

export async function getLogById(
  logId: number,
): Promise<InjectionRecord | null> {
  try {
    const result = await pool.query<InjectionRecord>(
      'SELECT * FROM injections WHERE id = $1',
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
    leg?: 'Right' | 'Left';
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
      } RETURNING *`,
      values,
    );
    return result.rows[0] || null;
  } catch (error) {
    logger.error('PostgreSQL error updating log', { logId, pgError: error });
    return null;
  }
}

// --- Keep closeDbPool function ---
export async function closeDbPool() {
  logger.info('Closing PostgreSQL connection pool...');
  await pool.end();
  logger.info('PostgreSQL pool closed.');
}

// --- Admin actions audit ---
export async function recordAdminAction(params: {
  adminUserId: string;
  targetUserId?: string;
  action: string;
  logId?: number;
  details?: string;
}) {
  const query = `
    INSERT INTO admin_actions (admin_user_id, target_user_id, action, log_id, details)
    VALUES ($1, $2, $3, $4, $5)`;
  const values = [
    params.adminUserId,
    params.targetUserId ?? null,
    params.action,
    params.logId ?? null,
    params.details ?? null,
  ];
  try {
    await pool.query(query, values);
  } catch (error) {
    logger.error('Failed to record admin action', { params, pgError: error });
  }
}

export async function updateSchedulerRunTimes(
  lastRunAt?: string,
  testLastRunAt?: string,
) {
  const query = `
    UPDATE global_settings
    SET
      last_run_at = COALESCE($1, last_run_at),
      test_last_run_at = COALESCE($2, test_last_run_at)
    WHERE id = 1`;
  try {
    await pool.query(query, [lastRunAt ?? null, testLastRunAt ?? null]);
  } catch (error) {
    logger.error('Failed to update scheduler run times', { pgError: error });
  }
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
