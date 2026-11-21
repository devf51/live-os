import type { Kysely } from 'kysely'
import type { Schema } from '../db/schema.js'

type Db = Kysely<Schema>
type FreqType = 'daily' | 'per_week' | 'weekdays'

export class HabitError extends Error {
  constructor(readonly code: 'invalid' | 'not_found', message: string) {
    super(message)
  }
}

// Bangkok days are 'YYYY-MM-DD' strings; calendar math runs in UTC on those (no zone, no DST involved).
const toMs = (day: string) => Date.parse(`${day}T00:00:00Z`)
const addDays = (day: string, n: number) => new Date(toMs(day) + n * 86400_000).toISOString().slice(0, 10)
const isoWeekday = (day: string) => new Date(toMs(day)).getUTCDay() || 7 // 1=Mon..7=Sun
const weekStart = (day: string) => addDays(day, 1 - isoWeekday(day))
export const isValidDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(toMs(day)) && addDays(day, 0) === day

/** Returns the canonical freqValue, or null when the combination is invalid. */
export function normalizeFreq(type: FreqType, value: string): string | null {
  if (type === 'daily') return value === '' ? '' : null
  if (type === 'per_week') return /^[1-7]$/.test(value) ? value : null
  const parts = value.split(',')
  if (!parts.every((p) => /^[1-7]$/.test(p)) || new Set(parts).size !== parts.length) return null
  return parts.sort().join(',')
}

function checked(name: string, type: FreqType, value: string) {
  const n = name.trim()
  if (n.length < 1 || n.length > 100) throw new HabitError('invalid', 'name must be 1..100 characters')
  const v = normalizeFreq(type, value)
  if (v === null) throw new HabitError('invalid', `invalid freqValue for ${type}`)
  return { name: n, freq_type: type, freq_value: v }
}

export async function addHabit(db: Db, h: { name: string; freqType: FreqType; freqValue: string }): Promise<{ id: number }> {
  const r = await db.insertInto('habits').values({ ...checked(h.name, h.freqType, h.freqValue), deleted_at: null }).executeTakeFirstOrThrow()
  return { id: Number(r.insertId) }
}

async function requireHabit(db: Db, id: number) {
  const r = await db.selectFrom('habits').selectAll().where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst()
  if (!r) throw new HabitError('not_found', `habit ${id} not found`)
  return r
}

export async function updateHabit(db: Db, id: number, p: { name?: string; freqType?: FreqType; freqValue?: string }): Promise<void> {
  const cur = await requireHabit(db, id)
  const set = checked(p.name ?? cur.name, p.freqType ?? cur.freq_type, p.freqValue ?? cur.freq_value)
  await db.updateTable('habits').set(set).where('id', '=', id).execute()
}

export async function deleteHabit(db: Db, id: number): Promise<void> {
  await requireHabit(db, id)
  await db.updateTable('habits').set({ deleted_at: new Date() }).where('id', '=', id).execute()
}

/** `today` = current Bangkok day; the single source of truth for rejecting future days. */
export async function logHabit(db: Db, habitId: number, day: string, today: string): Promise<void> {
  if (!isValidDay(day) || !isValidDay(today)) throw new HabitError('invalid', 'day must be a valid YYYY-MM-DD')
  if (day > today) throw new HabitError('invalid', 'day is in the future')
  await requireHabit(db, habitId)
  await db.insertInto('habit_logs').ignore().values({ habit_id: habitId, day }).execute() // UNIQUE(habit_id, day) => idempotent
}

export async function habitsDue(db: Db, day: string): Promise<{ id: number; name: string; done: boolean }[]> {
  const habits = await db.selectFrom('habits').selectAll().where('deleted_at', 'is', null).orderBy('id').execute()
  const logs = await db.selectFrom('habit_logs').select(['habit_id', 'day']).where('day', '>=', weekStart(day)).where('day', '<=', day).execute()
  const byHabit = new Map<number, string[]>()
  for (const l of logs) byHabit.set(Number(l.habit_id), [...(byHabit.get(Number(l.habit_id)) ?? []), l.day])
  const out: { id: number; name: string; done: boolean }[] = []
  for (const h of habits) {
    const id = Number(h.id)
    const days = byHabit.get(id) ?? []
    const done = days.includes(day)
    const due = h.freq_type === 'daily'
      || (h.freq_type === 'weekdays' && h.freq_value.split(',').includes(String(isoWeekday(day))))
      || (h.freq_type === 'per_week' && (done || days.length < Number(h.freq_value))) // stays visible the day it completes the target
    if (due) out.push({ id, name: h.name, done })
  }
  return out
}

export async function currentStreak(db: Db, habitId: number, today: string): Promise<number> {
  const h = await db.selectFrom('habits').selectAll().where('id', '=', habitId).where('deleted_at', 'is', null).executeTakeFirst()
  if (!h) return 0
  const days = new Set((await db.selectFrom('habit_logs').select('day').where('habit_id', '=', habitId).where('day', '<=', today).execute()).map((r) => r.day))
  let n = 0
  if (h.freq_type === 'per_week') {
    const target = Number(h.freq_value)
    const perWeek = new Map<string, number>()
    for (const d of days) perWeek.set(weekStart(d), (perWeek.get(weekStart(d)) ?? 0) + 1)
    let w = weekStart(today)
    if ((perWeek.get(w) ?? 0) < target) w = addDays(w, -7) // current week still open
    for (; (perWeek.get(w) ?? 0) >= target; w = addDays(w, -7)) n++
    return n
  }
  const scheduled = (d: string) => h.freq_type === 'daily' || h.freq_value.split(',').includes(String(isoWeekday(d)))
  let d = today
  if (scheduled(d) && !days.has(d)) d = addDays(d, -1) // today not logged yet does not break the streak
  // terminates: logs are finite, so a scheduled unlogged day is always reached
  for (; ; d = addDays(d, -1)) {
    if (!scheduled(d)) continue
    if (!days.has(d)) return n
    n++
  }
}
