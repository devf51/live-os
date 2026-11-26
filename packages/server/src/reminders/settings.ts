import type { Kysely } from 'kysely'
import { z } from 'zod'
import type { Schema } from '../db/schema.js'

export type ReminderSettings = { defaultLeadMinutes: number; quietStart: string; quietEnd: string; dailyCap: number }
export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = { defaultLeadMinutes: 30, quietStart: '22:00', quietEnd: '07:00', dailyCap: 10 }

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM (24h)')
export const settingsPatch = z.object({
  defaultLeadMinutes: z.number().int().min(0).max(10080),
  quietStart: hhmm,
  quietEnd: hhmm,
  dailyCap: z.number().int().min(1).max(100),
}).partial().strict()

const KEY = 'reminders'

export async function loadSettings(db: Kysely<Schema>): Promise<ReminderSettings> {
  const row = await db.selectFrom('settings').select('value_json').where('key', '=', KEY).executeTakeFirst()
  if (!row) return DEFAULT_REMINDER_SETTINGS
  let stored: unknown
  try { stored = JSON.parse(row.value_json) } catch { return DEFAULT_REMINDER_SETTINGS }
  const p = settingsPatch.safeParse(stored)
  return p.success ? { ...DEFAULT_REMINDER_SETTINGS, ...p.data } as ReminderSettings : DEFAULT_REMINDER_SETTINGS
}

export async function saveSettings(db: Kysely<Schema>, s: ReminderSettings): Promise<void> {
  const value_json = JSON.stringify(s)
  await db.insertInto('settings').values({ key: KEY, value_json }).onDuplicateKeyUpdate({ value_json }).execute()
}
