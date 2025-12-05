// src/database.ts
import { Pool } from 'pg';
import type { QueryResult } from 'pg';
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

// --- Database Connection Pool ---
let pool: Pool;
try {
  pool = new Pool({
    connectionString: config.databaseUrl,
  });
  pool.on('error', (err, client) => {
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
    queryText += ' WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1';
    params.push(userId);
  } else {
    queryText += ' ORDER BY created_at DESC LIMIT 1';
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
  limit: number = 5,
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

export async function enforceMaxFiveRecords(userId: string): Promise<void> {
  const maxRecords = 5;
  try {
    await pool.query('BEGIN');
    const findCutoffQuery = `
            SELECT id FROM injections WHERE user_id = $1
            ORDER BY created_at DESC OFFSET $2 LIMIT 1`;
    const cutoffResult = await pool.query(findCutoffQuery, [
      userId,
      maxRecords - 1,
    ]);
    const cutoffId = cutoffResult.rows[0]?.id;
    if (cutoffId) {
      const getIdsToDeleteQuery = `
                SELECT id FROM injections WHERE user_id = $1 AND created_at < (
                    SELECT created_at FROM injections WHERE id = $2 )`;
      const idsResult = await pool.query(getIdsToDeleteQuery, [
        userId,
        cutoffId,
      ]);
      const idsToDelete = idsResult.rows.map((row) => row.id);
      if (idsToDelete.length > 0) {
        const deleteQuery = 'DELETE FROM injections WHERE id = ANY($1::int[])';
        const deleteResult = await pool.query(deleteQuery, [idsToDelete]);
        logger.info(
          `Deleted ${deleteResult.rowCount} old record(s) for user ${userId} to maintain max ${maxRecords}.`,
        );
      }
    }
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    logger.error(
      'PostgreSQL error enforcing max records, rolled back transaction',
      { userId, pgError: error },
    );
  }
}

export function getNextLeg(lastLeg?: string | null): 'Right' | 'Left' {
  return lastLeg === 'Right' ? 'Left' : 'Right';
}

export async function createInjectionRecord(
  userId: string,
  options?: {
    medication?: string | null;
    doseMg?: number | null;
    performedAt?: string | Date | null;
    rawUnits?: number | null;
    adminUserId?: string | null;
  },
): Promise<
  | {
      id: number;
      leg: 'Right' | 'Left';
      date: string;
      medication: string | null;
      dose_mg: number | string | null;
      performed_at: string;
      raw_units: number | null;
    }
  | null
> {
  try {
    const lastRecord = await getLastRecord(userId);
    if (lastRecord === null && !userId) {
      logger.warn(
        'createInjectionRecord cannot proceed because getLastRecord failed or returned null unexpectedly.',
      );
    }

    const nextLeg = getNextLeg(lastRecord?.leg);
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
    await pool.query('BEGIN');
    const selectQuery = 'SELECT * FROM injections WHERE id = $1';
    const selectResult = await pool.query<InjectionRecord>(selectQuery, [
      logId,
    ]);
    const recordToDelete = selectResult.rows[0];
    if (!recordToDelete) {
      await pool.query('ROLLBACK');
      logger.warn('Attempted to delete non-existent log entry', {
        logId,
        userIdToCheck,
      });
      return { success: false };
    }
    if (userIdToCheck && recordToDelete.user_id !== userIdToCheck) {
      await pool.query('ROLLBACK');
      logger.warn(
        'User attempted to delete log entry belonging to another user',
        {
          logId,
          requestingUser: userIdToCheck,
          ownerUser: recordToDelete.user_id,
        },
      );
      return { success: false };
    }
    const deleteQuery = 'DELETE FROM injections WHERE id = $1';
    const deleteResult = await pool.query(deleteQuery, [logId]);
    if (deleteResult.rowCount === 1) {
      await pool.query('COMMIT');
      logger.info('Successfully deleted log entry', {
        logId,
        userId: recordToDelete.user_id,
      });
      return { success: true, deletedRecord: recordToDelete };
    } else {
      await pool.query('ROLLBACK');
      logger.error('Failed to delete log entry after finding it', { logId });
      return { success: false };
    }
  } catch (error) {
    await pool.query('ROLLBACK');
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
    await pool.query('BEGIN');
    const findLatestQuery = `
            SELECT * FROM injections WHERE user_id = $1
            ORDER BY created_at DESC, id DESC LIMIT 1`;
    const findResult = await pool.query<InjectionRecord>(findLatestQuery, [
      userId,
    ]);
    const latestRecord = findResult.rows[0];
    if (!latestRecord) {
      await pool.query('ROLLBACK');
      logger.info('No logs found to delete for user', { userId });
      return { success: false };
    }
    const deleteQuery = 'DELETE FROM injections WHERE id = $1';
    const deleteResult = await pool.query(deleteQuery, [latestRecord.id]);
    if (deleteResult.rowCount === 1) {
      await pool.query('COMMIT');
      logger.info('Successfully deleted latest log entry for user', {
        userId,
        deletedLogId: latestRecord.id,
      });
      return { success: true, deletedRecord: latestRecord };
    } else {
      await pool.query('ROLLBACK');
      logger.error('Failed to delete latest log entry after finding it', {
        userId,
        logId: latestRecord.id,
      });
      return { success: false };
    }
  } catch (error) {
    await pool.query('ROLLBACK');
    logger.error('PostgreSQL error deleting latest log for user', {
      userId,
      pgError: error,
    });
    return { success: false };
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
