// src/database.ts
import { Pool } from 'pg';
import type { QueryResult } from 'pg';
import { config } from './config';
import logger from './logger';

// --- Interfaces ---
export interface InjectionRecord {
  id: number;
  user_id: string;
  leg: 'Right' | 'Left';
  injection_date: string; // Format DD-MM-YYYY
  created_at: Date;
}

export interface GlobalSettings {
  id: number;
  injection_day: number;
  injection_time: string;
  timezone: string;
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
    'SELECT id, user_id, leg, injection_date, created_at FROM injections';
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
        SELECT id, user_id, leg, injection_date, created_at
        FROM injections WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`;
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
        SELECT id, user_id, leg, injection_date, created_at
        FROM injections WHERE user_id = $1 ORDER BY created_at ASC`;
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
): Promise<{ leg: 'Right' | 'Left'; date: string } | null> {
  try {
    const lastRecord = await getLastRecord(userId);
    if (lastRecord === null && !userId) {
      logger.warn(
        'createInjectionRecord cannot proceed because getLastRecord failed or returned null unexpectedly.',
      );
    }

    const nextLeg = getNextLeg(lastRecord?.leg);
    const now = new Date();
    const day = now.getDate().toString().padStart(2, '0');
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const year = now.getFullYear();
    const injectionDate = `${day}-${month}-${year}`;
    const insertQuery = `
            INSERT INTO injections (user_id, leg, injection_date)
            VALUES ($1, $2, $3) RETURNING leg, injection_date`;
    const params = [userId, nextLeg, injectionDate];
    const result = await pool.query(insertQuery, params);
    if (result.rowCount === 1) {
      await enforceMaxFiveRecords(userId);
      return { leg: result.rows[0].leg, date: result.rows[0].injection_date };
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
    'SELECT id, injection_day, injection_time, timezone FROM global_settings WHERE id = 1 LIMIT 1';
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
        INSERT INTO global_settings (id, injection_day, injection_time, timezone)
        VALUES (1, $1, $2, $3)
        ON CONFLICT (id) DO UPDATE SET
            injection_day = EXCLUDED.injection_day,
            injection_time = EXCLUDED.injection_time,
            timezone = EXCLUDED.timezone`;
  const params = [
    settings.injection_day,
    settings.injection_time,
    settings.timezone,
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
