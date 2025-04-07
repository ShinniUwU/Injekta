// src/supabase.ts
import { createClient } from '@supabase/supabase-js';
import type {
  SupabaseClient,
  PostgrestSingleResponse,
} from '@supabase/supabase-js'; // Use import type
import dotenv from 'dotenv';
import logger from './logger';
import { config } from './config';

dotenv.config();

export const supabaseUrl = config.supabaseUrl;
export const supabaseAnonKey = config.supabaseAnonKey;

if (!supabaseUrl || !supabaseAnonKey) {
  logger.error('Supabase URL or Anon Key is missing in configuration.');
  process.exit(1);
}

export interface InjectionRecord {
  id: number;
  user_id: string;
  leg: string;
  injection_date: string;
  created_at: string;
}

export interface GlobalSettings {
  id: number;
  injection_day: number;
  injection_time: string;
  timezone: string;
}

export const supabase: SupabaseClient = createClient(
  supabaseUrl,
  supabaseAnonKey,
);

// --- Database Functions ---

export async function getLastRecord(
  userId?: string,
): Promise<InjectionRecord | null> {
  try {
    let queryBuilder = supabase
      .from('injections')
      .select<string, InjectionRecord>('*');

    if (userId) {
      queryBuilder = queryBuilder.eq('user_id', userId);
    }

    const { data, error } = await queryBuilder
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.error('Supabase error fetching last record:', {
        userId,
        message: error.message,
        details: error.details,
        code: error.code,
      });
      return null;
    }
    return data;
  } catch (e) {
    logger.error('Unexpected error in getLastRecord:', e);
    return null;
  }
} // Closing brace for getLastRecord

export async function enforceMaxFiveRecords(userId: string): Promise<void> {
  try {
    // Opening brace for try block (matches related info start point)
    const { count, error: countError } = await supabase
      .from('injections')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (countError) {
      logger.error('Supabase error counting records:', {
        userId,
        message: countError.message,
      });
      return;
    }

    if (count !== null && count >= 5) {
      const numToDelete = count - 4;

      const { data: oldestRecords, error: selectError } = await supabase
        .from('injections')
        .select('id')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(numToDelete);

      if (selectError) {
        logger.error('Supabase error selecting oldest records to delete:', {
          userId,
          message: selectError.message,
        });
        return;
      }

      if (oldestRecords && oldestRecords.length > 0) {
        const idsToDelete = oldestRecords.map((record) => record.id);

        const { error: deleteError } = await supabase
          .from('injections')
          .delete()
          .in('id', idsToDelete);

        if (deleteError) {
          logger.error('Supabase error deleting oldest records:', {
            userId,
            ids: idsToDelete,
            message: deleteError.message,
          });
        } else {
          logger.info(
            `Deleted ${idsToDelete.length} oldest record(s) for user ${userId} to maintain max 5.`,
          ); // Line 104 area
        } // Closing brace for else
      } // Closing brace for if(oldestRecords...)
    } // Closing brace for if(count...)
  } catch (e) {
    // Closing brace for try, opening for catch
    logger.error('Unexpected error in enforceMaxFiveRecords:', e);
  } // Closing brace for catch
} // Closing brace for enforceMaxFiveRecords

export function getNextLeg(lastLeg?: string | null): string {
  return lastLeg === 'Right' ? 'Left' : 'Right';
} // Closing brace for getNextLeg

export async function createInjectionRecord(
  userId: string,
): Promise<{ leg: string; date: string } | null> {
  try {
    const lastRecord = await getLastRecord(userId);
    const nextLeg = getNextLeg(lastRecord?.leg);

    const now = new Date();
    const day = now.getDate().toString().padStart(2, '0');
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const year = now.getFullYear();
    const injectionDate = `${day}-${month}-${year}`;

    const newRecord: Omit<InjectionRecord, 'id' | 'created_at'> = {
      user_id: userId,
      leg: nextLeg,
      injection_date: injectionDate,
    };

    const { data, error } = await supabase
      .from('injections')
      .insert(newRecord)
      .select()
      .single();

    if (error) {
      logger.error('Supabase error inserting new record:', {
        userId,
        message: error.message,
      });
      return null;
    }
    if (!data) {
      logger.error('Supabase insert returned success but no data.', { userId });
      return null;
    }

    await enforceMaxFiveRecords(userId);
    return { leg: nextLeg, date: injectionDate };
  } catch (e) {
    logger.error('Unexpected error in createInjectionRecord:', e);
    return null;
  }
} // Closing brace for createInjectionRecord

export async function getGlobalSettings(): Promise<GlobalSettings | null> {
  try {
    const { data, error } = await supabase
      .from('global_settings')
      .select('*')
      .eq('id', 1)
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.error('Supabase error fetching global settings:', {
        message: error.message,
      });
      return null;
    }
    return data;
  } catch (e) {
    logger.error('Unexpected error in getGlobalSettings:', e);
    return null;
  }
} // Closing brace for getGlobalSettings

export async function setGlobalSettings(
  settings: Omit<GlobalSettings, 'id'>,
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('global_settings')
      .upsert({ id: 1, ...settings }, { onConflict: 'id' });

    if (error) {
      logger.error('Supabase error setting global settings:', {
        message: error.message,
      });
      return false;
    }
    return true;
  } catch (e) {
    logger.error('Unexpected error in setGlobalSettings:', e);
    return false;
  }
} // Closing brace for setGlobalSettings
