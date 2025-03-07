// src/supabase.ts
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import logger from './logger';

dotenv.config();

export const supabaseUrl = process.env.SUPABASE_URL as string;
export const supabaseAnonKey = process.env.SUPABASE_ANON_KEY as string;
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface InjectionRecord {
  id: number;
  user_id: string;
  leg: string;
  injection_date: string;
  created_at: string;
}

export interface GlobalSettings {
  id: number;
  injection_day: number; // 0=Sunday, …,6=Saturday
  injection_time: string; // "HH:MM", e.g., "09:00"
  timezone: string; // e.g., "UTC", "America/New_York"
}

export async function getLastRecord(
  userId?: string,
): Promise<InjectionRecord | null> {
  // Use .from() without generics, then cast the result.
  let query = supabase.from('injections') as unknown as {
    select: (cols: string) => any;
    eq: (column: string, value: string) => any;
  };
  if (userId) {
    query = query.eq('user_id', userId);
  }
  const { data, error } = await query
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) {
    logger.error('Error fetching last record:', error);
    return null;
  }
  return data && data.length ? (data[0] as InjectionRecord) : null;
}

export async function enforceMaxFiveRecords(userId?: string): Promise<void> {
  let query = supabase.from('injections') as any;
  query = query.select('*').order('created_at', { ascending: true });
  if (userId) query = query.eq('user_id', userId);

  const { data, error } = await query;
  if (error) {
    logger.error('Error fetching records:', error);
    return;
  }
  if (data && data.length >= 5) {
    const oldestId = data[0].id;
    const { error: deleteError } = await supabase
      .from('injections')
      .delete()
      .eq('id', oldestId);
    if (deleteError) {
      logger.error('Error deleting oldest record:', deleteError);
    } else {
      console.log(
        `Deleted record with id = ${oldestId} to maintain max 5 records.`,
      );
    }
  }
}

export function getNextLeg(lastLeg: string): string {
  return lastLeg === 'Good' ? 'Bad' : 'Good';
}

export async function createInjectionRecord(
  userId: string,
): Promise<{ leg: string; date: string } | null> {
  const lastRecord = await getLastRecord(userId);
  let nextLeg = 'Good';
  if (lastRecord) {
    nextLeg = getNextLeg(lastRecord.leg);
  }
  // Format current date as DD-MM-YYYY.
  const now = new Date();
  const day = now.getDate().toString().padStart(2, '0');
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const year = now.getFullYear();
  const injectionDate = `${day}-${month}-${year}`;

  const { data, error } = await supabase
    .from('injections')
    .insert([{ user_id: userId, leg: nextLeg, injection_date: injectionDate }]);
  if (error) {
    logger.error('Error inserting new record:', error);
    return null;
  }
  await enforceMaxFiveRecords(userId);
  return { leg: nextLeg, date: injectionDate };
}

export async function getGlobalSettings(): Promise<GlobalSettings | null> {
  const { data, error } = await supabase
    .from<'global_settings', GlobalSettings>('global_settings')
    .select('*')
    .limit(1)
    .single();
  if (error) {
    logger.error('Error fetching global settings:', error);
    return null;
  }
  return data;
}

export async function setGlobalSettings(
  settings: Omit<GlobalSettings, 'id'>,
): Promise<boolean> {
  const { error } = await supabase
    .from('global_settings')
    .upsert({ id: 1, ...settings });
  if (error) {
    logger.error('Error setting global settings:', error);
    return false;
  }
  return true;
}
