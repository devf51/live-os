import type { Insertable, Kysely } from 'kysely'
import { bangkokDay, bangkokDayRange, bangkokMonthKey } from '@live-os/shared/time'
import type { Schema } from '../db/schema.js'
import { budgetCrossings } from '../ledger/ledger.js'
import { occurrencesBetween } from '../planner/planner.js'
import { DEFAULT_REMINDER_SETTINGS, type ReminderSettings } from './settings.js'

export { DEFAULT_REMINDER_SETTINGS, type ReminderSettings }
type Db = Kysely<Schema>
type NewReminder = Insertable<Schema['reminders']>

const MIN = 60_000
const HORIZON = 10080 * MIN + MIN // one week of lead + the 60s planning slack

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))

/** Bangkok is a fixed UTC+7; start == end means no quiet period. */
export function inQuietHours(now: Date, s: ReminderSettings): boolean {
  const start = minutes(s.quietStart), end = minutes(s.quietEnd)
  if (start === end) return false
  const m = (Math.floor(now.getTime() / MIN) + 7 * 60) % 1440
  return start < end ? m >= start && m < end : m >= start || m < end
}

export async function planReminders(db: Db, now: Date, settings: ReminderSettings): Promise<number> {
  const horizon = now.getTime() + 60_000
  const want: NewReminder[] = []
  const events = await db.selectFrom('events').selectAll().where('deleted_at', 'is', null).execute()
  for (const e of events) {
    const lead = (e.lead_minutes ?? settings.defaultLeadMinutes) * MIN
    const occs = occurrencesBetween({ startsAt: e.starts_at, repeatWeekly: Boolean(e.repeat_weekly) }, now, new Date(now.getTime() + HORIZON))
    for (const occ of occs) {
      const fireAt = occ.getTime() - lead
      if (occ.getTime() <= now.getTime() || fireAt > horizon) continue
      want.push({ kind: 'event', ref_id: Number(e.id), dedupe_key: `event:${e.id}:${occ.toISOString()}`, fire_at: new Date(fireAt), level: null, occurs_at: occ, attempts: 0 })
    }
  }
  const month = bangkokMonthKey(now)
  for (const c of await budgetCrossings(db, month))
    want.push({ kind: 'budget', ref_id: c.categoryId, dedupe_key: `budget:${c.categoryId}:${month}:${c.level}`, fire_at: now, level: c.level, occurs_at: null, attempts: 0 })
  if (want.length === 0) return 0

  const existing = new Set((await db.selectFrom('reminders').select('dedupe_key').where('dedupe_key', 'in', want.map((w) => w.dedupe_key)).execute()).map((r) => r.dedupe_key))
  const fresh = want.filter((w) => !existing.has(w.dedupe_key))
  if (fresh.length === 0) return 0
  // no-op update (not INSERT IGNORE) so a lost race on the UNIQUE key is harmless but other errors still surface
  await db.insertInto('reminders').values(fresh).onDuplicateKeyUpdate((eb) => ({ dedupe_key: eb.ref('dedupe_key') })).execute()
  return fresh.length
}

export async function dueReminders(db: Db, now: Date, settings: ReminderSettings): Promise<{ id: number; kind: string; refId: number }[]> {
  const rows = await db.selectFrom('reminders').select(['id', 'kind', 'ref_id', 'occurs_at'])
    .where('sent_at', 'is', null).where('fire_at', '<=', now).where('attempts', '<', 3)
    .orderBy('fire_at').orderBy('id').execute()
  let budgetRoom = 0
  if (!inQuietHours(now, settings)) {
    const [from, to] = bangkokDayRange(bangkokDay(now))
    const sent = await db.selectFrom('reminders').select((eb) => eb.fn.countAll().as('n'))
      .where('kind', '=', 'budget').where('sent_at', '>=', from).where('sent_at', '<', to).executeTakeFirstOrThrow()
    budgetRoom = Math.max(0, settings.dailyCap - Number(sent.n))
  }
  const out: { id: number; kind: string; refId: number }[] = []
  for (const r of rows) {
    if (r.kind === 'event') { if (!r.occurs_at || r.occurs_at.getTime() <= now.getTime()) continue }
    else if (r.kind === 'budget') { if (budgetRoom-- <= 0) continue }
    else continue // tasks never get reminders
    out.push({ id: Number(r.id), kind: r.kind, refId: Number(r.ref_id) })
  }
  return out
}
