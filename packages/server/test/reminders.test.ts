import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql, type Kysely } from 'kysely'
import { testDb } from './helpers/testDb.js'
import { migrate } from '../src/db/client.js'
import type { Schema } from '../src/db/schema.js'
import { buildApp } from '../src/app.js'
import { testPush } from './helpers/push.js'
import { hashPassword } from '../src/auth/auth.js'
import { addEvent, deleteEvent } from '../src/planner/planner.js'
import { addCategory, addTransaction, setBudget } from '../src/ledger/ledger.js'
import { DEFAULT_REMINDER_SETTINGS, dueReminders, inQuietHours, planReminders } from '../src/reminders/reminders.js'
import { loadSettings, saveSettings } from '../src/reminders/settings.js'

let db: Kysely<Schema>
let food: number
const S = DEFAULT_REMINDER_SETTINGS
const at = (s: string) => new Date(s)
beforeAll(async () => { db = await testDb() })
afterAll(async () => { await db.destroy() })
beforeEach(async () => {
  for (const t of ['reminders', 'settings', 'events', 'budgets', 'transactions', 'categories'] as const) await db.deleteFrom(t).execute()
  food = (await addCategory(db, 'อาหาร', 'expense')).id
})
const rows = () => db.selectFrom('reminders').selectAll().orderBy('id').execute()
// class 09:00 Bangkok on 2026-11-23 = 02:00Z
const klass = (extra: object = {}) =>
  addEvent(db, { title: 'เรียน', kind: 'class', startsAt: at('2026-11-23T02:00:00Z'), repeatWeekly: false, ...extra })
const spend = (amountSatang: number, when = '2026-11-15T05:00:00Z') =>
  addTransaction(db, { categoryId: food, kind: 'expense', amountSatang, occurredAt: at(when) })

describe('migration 002', () => {
  it('idempotent, columns exist', async () => {
    await migrate(db)
    const { rows: r } = await sql<{ n: string }>`select column_name as n from information_schema.columns where table_schema = database() and table_name = 'reminders'`.execute(db)
    const names = r.map((x) => x.n.toLowerCase())
    expect(names).toContain('level')
    expect(names).toContain('occurs_at')
  })
})

describe('inQuietHours (Bangkok time)', () => {
  it('crossing midnight 22:00-07:00', () => {
    expect(inQuietHours(at('2026-11-23T16:00:00Z'), S)).toBe(true) // 23:00 BKK (16:00 UTC = 23:00)
    expect(inQuietHours(at('2026-11-23T05:00:00Z'), S)).toBe(false) // 12:00 BKK
    expect(inQuietHours(at('2026-11-23T20:00:00Z'), S)).toBe(true) // 03:00 BKK
    expect(inQuietHours(at('2026-11-23T00:00:00Z'), S)).toBe(false) // 07:00 BKK, end exclusive
    expect(inQuietHours(at('2026-11-23T15:00:00Z'), S)).toBe(true) // 22:00 BKK, start inclusive
    expect(inQuietHours(at('2026-11-23T14:59:00Z'), S)).toBe(false) // 21:59 BKK
  })
  it('non-crossing 13:00-15:00 and empty range', () => {
    const s = { ...S, quietStart: '13:00', quietEnd: '15:00' }
    expect(inQuietHours(at('2026-11-23T07:00:00Z'), s)).toBe(true) // 14:00 BKK
    expect(inQuietHours(at('2026-11-23T05:00:00Z'), s)).toBe(false) // 12:00 BKK
    expect(inQuietHours(at('2026-11-23T16:00:00Z'), { ...S, quietStart: '08:00', quietEnd: '08:00' })).toBe(false)
  })
})

describe('settings', () => {
  it('defaults, save, merge, invalid stored JSON', async () => {
    expect(await loadSettings(db)).toEqual(S)
    await saveSettings(db, { ...S, dailyCap: 3 })
    await saveSettings(db, { ...S, dailyCap: 4 })
    expect((await loadSettings(db)).dailyCap).toBe(4)
    await db.updateTable('settings').set({ value_json: '{"dailyCap":2}' }).where('key', '=', 'reminders').execute()
    expect(await loadSettings(db)).toEqual({ ...S, dailyCap: 2 })
    for (const bad of ['not json', '[1]', '{"dailyCap":-5}', 'null']) {
      await db.updateTable('settings').set({ value_json: bad }).where('key', '=', 'reminders').execute()
      expect(await loadSettings(db)).toEqual(S)
    }
  })
})

describe('planReminders: events', () => {
  const now = at('2026-11-23T01:40:00Z') // 08:40 BKK; fire_at 08:30 BKK is 10 min past
  it('class 09:00 -> reminder at 08:30; twice / restart -> same rows, returns N then 0', async () => {
    const { id } = await klass()
    expect(await planReminders(db, at('2026-11-23T01:29:30Z'), S)).toBe(1)
    expect(await planReminders(db, at('2026-11-23T01:29:30Z'), S)).toBe(0)
    expect(await planReminders(db, at('2026-11-23T01:35:00Z'), S)).toBe(0) // "restart", later now
    const r = await rows()
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ kind: 'event', ref_id: id, level: null, dedupe_key: `event:${id}:2026-11-23T02:00:00.000Z` })
    expect(r[0]!.fire_at).toEqual(at('2026-11-23T01:30:00Z'))
    expect(r[0]!.occurs_at).toEqual(at('2026-11-23T02:00:00Z'))
  })
  it('not yet within fire window -> nothing', async () => {
    await klass()
    expect(await planReminders(db, at('2026-11-23T01:00:00Z'), S)).toBe(0)
  })
  it('lead override beats default; changing lead later does not double-send', async () => {
    const { id } = await klass({ leadMinutes: 10 })
    expect(await planReminders(db, at('2026-11-23T01:50:00Z'), S)).toBe(1)
    expect((await rows())[0]!.fire_at).toEqual(at('2026-11-23T01:50:00Z'))
    await db.updateTable('events').set({ lead_minutes: 20 }).where('id', '=', id).execute()
    expect(await planReminders(db, at('2026-11-23T01:41:00Z'), S)).toBe(0)
  })
  it('already past fire_at but upcoming -> created; already started -> none', async () => {
    await klass()
    expect(await planReminders(db, now, S)).toBe(1)
    await db.deleteFrom('reminders').execute()
    expect(await planReminders(db, at('2026-11-23T02:02:00Z'), S)).toBe(0) // occ + grace <= now
    expect(await planReminders(db, at('2026-11-23T02:05:00Z'), S)).toBe(0)
  })
  it('weekly class: right occurrence, next week separate', async () => {
    await klass({ repeatWeekly: true })
    expect(await planReminders(db, at('2026-11-30T01:35:00Z'), S)).toBe(1)
    expect((await rows())[0]!.occurs_at).toEqual(at('2026-11-30T02:00:00Z'))
    expect(await planReminders(db, at('2026-12-07T01:35:00Z'), S)).toBe(1)
    expect(await rows()).toHaveLength(2)
  })
  it('soft-deleted events excluded', async () => {
    const { id } = await klass()
    await db.updateTable('events').set({ deleted_at: new Date() }).where('id', '=', id).execute()
    expect(await planReminders(db, now, S)).toBe(0)
  })
  it('default lead from settings is used', async () => {
    await klass()
    expect(await planReminders(db, at('2026-11-23T00:55:00Z'), { ...S, defaultLeadMinutes: 120 })).toBe(1) // 07:00 BKK fire
  })
})

describe('planReminders: budgets', () => {
  const now = at('2026-11-15T06:00:00Z')
  it('80 -> one row, 100 -> a second, never duplicated, new month new rows', async () => {
    await setBudget(db, food, '2026-11', 10000)
    expect(await planReminders(db, now, S)).toBe(0)
    await spend(8000)
    expect(await planReminders(db, now, S)).toBe(1)
    expect(await planReminders(db, at('2026-11-16T06:00:00Z'), S)).toBe(0)
    await spend(2000)
    expect(await planReminders(db, now, S)).toBe(1)
    expect(await planReminders(db, now, S)).toBe(0)
    const r = await rows()
    expect(r.map((x) => [x.kind, x.ref_id, x.level, x.occurs_at])).toEqual([['budget', food, 80, null], ['budget', food, 100, null]])
    expect(r[0]!.dedupe_key).toBe(`budget:${food}:2026-11:80`)
    expect(r[0]!.fire_at).toEqual(now)
    await setBudget(db, food, '2026-12', 1000)
    await spend(1000, '2026-12-02T05:00:00Z')
    expect(await planReminders(db, at('2026-12-03T05:00:00Z'), S)).toBe(2)
  })
})

describe('dueReminders', () => {
  it('06:30 BKK reminder for a 07:00 class is due inside quiet hours; not once started', async () => {
    await klass({ startsAt: at('2026-11-22T00:00:00Z') }) // 07:00 BKK on 22nd
    const n = at('2026-11-21T23:31:00Z') // 06:31 BKK, quiet
    expect(inQuietHours(n, S)).toBe(true)
    await planReminders(db, n, S)
    expect(await dueReminders(db, n, S)).toHaveLength(1)
    expect(await dueReminders(db, at('2026-11-22T00:02:00Z'), S)).toHaveLength(0) // past start + grace
    expect(await dueReminders(db, at('2026-11-21T23:20:00Z'), S)).toHaveLength(0) // before fire_at
  })
  it('event row shape and attempts/sent filters', async () => {
    const { id } = await klass()
    const n = at('2026-11-23T01:35:00Z')
    await planReminders(db, n, S)
    expect(await dueReminders(db, n, S)).toEqual([{ id: expect.any(Number), kind: 'event', refId: id }])
    await db.updateTable('reminders').set({ attempts: 3 }).execute()
    expect(await dueReminders(db, n, S)).toEqual([])
    await db.updateTable('reminders').set({ attempts: 0, sent_at: n }).execute()
    expect(await dueReminders(db, n, S)).toEqual([])
  })
  it('budget in quiet hours waits, then is due after', async () => {
    await setBudget(db, food, '2026-11', 10000)
    await spend(8000)
    const quiet = at('2026-11-15T16:00:00Z') // 23:00 BKK
    await planReminders(db, quiet, S)
    expect(await dueReminders(db, quiet, S)).toEqual([])
    expect(await dueReminders(db, at('2026-11-15T23:59:00Z'), S)).toEqual([]) // 06:59
    expect(await dueReminders(db, at('2026-11-16T00:00:00Z'), S)).toHaveLength(1) // 07:00
  })
  it('daily cap blocks the 11th budget reminder but never an event reminder', async () => {
    const n = at('2026-11-15T06:00:00Z') // 13:00 BKK
    const cats: number[] = []
    for (let i = 0; i < 12; i++) cats.push((await addCategory(db, `c${i}`, 'expense')).id)
    for (const c of cats)
      await db.insertInto('reminders').values({ kind: 'budget', ref_id: c, dedupe_key: `budget:${c}:2026-11:80`, fire_at: n, sent_at: null, attempts: 0, level: 80, occurs_at: null }).execute()
    // 10 sent today (Bangkok day), mark first 10 sent
    const ids = (await rows()).map((r) => r.id)
    await db.updateTable('reminders').set({ sent_at: at('2026-11-15T03:00:00Z') }).where('id', 'in', ids.slice(0, 10)).execute()
    expect(await dueReminders(db, n, S)).toEqual([]) // 2 pending, cap reached
    expect(await dueReminders(db, n, { ...S, dailyCap: 11 })).toHaveLength(1)
    // sent yesterday (Bangkok) does not count: 2026-11-14T16:59Z is 23:59 BKK on the 14th
    await db.updateTable('reminders').set({ sent_at: at('2026-11-14T16:59:00Z') }).where('id', 'in', ids.slice(0, 10)).execute()
    expect(await dueReminders(db, n, S)).toHaveLength(2)
    // event reminder still due at the cap
    await db.updateTable('reminders').set({ sent_at: at('2026-11-15T03:00:00Z') }).where('id', 'in', ids.slice(0, 10)).execute()
    await klass({ startsAt: at('2026-11-15T06:30:00Z') })
    await planReminders(db, n, S)
    expect((await dueReminders(db, n, S)).map((d) => d.kind)).toEqual(['event'])
  })
})

// simulate the scheduler: plan, pick due, mark delivered (as Task 8 does)
async function run(startIso: string, endIso: string, stepSec: number, settings = S) {
  const delivered: number[] = []
  for (let t = at(startIso).getTime(); t <= at(endIso).getTime(); t += stepSec * 1000) {
    const now = new Date(t)
    await planReminders(db, now, settings)
    for (const d of await dueReminders(db, now, settings)) {
      delivered.push(d.id)
      await db.updateTable('reminders').set({ sent_at: now }).where('id', '=', d.id).execute()
    }
  }
  return delivered
}

describe('grace and tick simulation', () => {
  it('lead 0 (per-event) delivered exactly once with 60s ticks', async () => {
    await klass({ leadMinutes: 0 })
    expect(await run('2026-11-23T01:55:00.500Z', '2026-11-23T02:06:00Z', 60)).toHaveLength(1)
  })
  it('defaultLeadMinutes 0 via settings', async () => {
    await klass()
    expect(await run('2026-11-23T01:55:00.500Z', '2026-11-23T02:06:00Z', 60, { ...S, defaultLeadMinutes: 0 })).toHaveLength(1)
  })
  it('lead 1 with 90s jitter delivered exactly once', async () => {
    await klass({ leadMinutes: 1 })
    expect(await run('2026-11-23T01:50:00Z', '2026-11-23T02:06:00Z', 90)).toHaveLength(1)
  })
  it('not delivered once now >= occurs_at + grace', async () => {
    await klass({ leadMinutes: 0 })
    await planReminders(db, at('2026-11-23T02:00:00Z'), S)
    expect(await dueReminders(db, at('2026-11-23T02:01:59Z'), S)).toHaveLength(1)
    expect(await dueReminders(db, at('2026-11-23T02:02:00Z'), S)).toHaveLength(0)
  })
})

describe('stale reminders', () => {
  const n = at('2026-11-23T01:35:00Z')
  it('delete after plan -> not due', async () => {
    const { id } = await klass()
    await planReminders(db, n, S)
    await deleteEvent(db, id)
    expect(await dueReminders(db, n, S)).toEqual([])
  })
  it('move after plan -> old row not due, new occurrence planned and due', async () => {
    const { id } = await klass()
    await planReminders(db, n, S)
    await db.updateTable('events').set({ starts_at: at('2026-11-23T03:00:00Z') }).where('id', '=', id).execute()
    expect(await dueReminders(db, n, S)).toEqual([])
    const later = at('2026-11-23T02:31:00Z')
    expect(await planReminders(db, later, S)).toBe(1)
    const due = await dueReminders(db, later, S)
    expect(due).toHaveLength(1)
    expect((await rows()).find((r) => r.id === due[0]!.id)!.occurs_at).toEqual(at('2026-11-23T03:00:00Z'))
  })
  it('weekly: moved by non-multiple of a week -> old row not due; multiple of a week still due', async () => {
    const { id } = await klass({ repeatWeekly: true })
    await planReminders(db, n, S)
    await db.updateTable('events').set({ starts_at: at('2026-11-09T02:00:00Z') }).where('id', '=', id).execute() // 14 days earlier
    expect(await dueReminders(db, n, S)).toHaveLength(1)
    await db.updateTable('events').set({ starts_at: at('2026-11-09T02:30:00Z') }).where('id', '=', id).execute()
    expect(await dueReminders(db, n, S)).toEqual([])
    await db.updateTable('events').set({ starts_at: at('2026-11-24T02:00:00Z') }).where('id', '=', id).execute() // starts after occurrence
    expect(await dueReminders(db, n, S)).toEqual([])
  })
})

describe('routes', () => {
  let app: ReturnType<typeof buildApp>
  let cookies: Record<string, string>
  beforeAll(async () => {
    app = buildApp({ db, ownerPasswordHash: await hashPassword('pw'), sessionSecret: 'test-secret-test-secret', ...testPush })
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'pw' } })
    cookies = { [res.cookies[0]!.name]: res.cookies[0]!.value }
  })
  const put = (payload: object) => app.inject({ method: 'PUT', url: '/settings', payload, cookies })
  it('401 without session', async () => {
    expect((await app.inject({ url: '/settings' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'PUT', url: '/settings', payload: {} })).statusCode).toBe(401)
  })
  it('GET defaults, PUT valid persists', async () => {
    expect((await app.inject({ url: '/settings', cookies })).json()).toEqual(S)
    const res = await put({ dailyCap: 5, quietStart: '23:30' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ...S, dailyCap: 5, quietStart: '23:30' })
    expect((await app.inject({ url: '/settings', cookies })).json()).toEqual({ ...S, dailyCap: 5, quietStart: '23:30' })
    expect((await loadSettings(db)).dailyCap).toBe(5)
  })
  it('PUT invalid -> 400', async () => {
    for (const bad of [{ dailyCap: -1 }, { dailyCap: 0 }, { dailyCap: 101 }, { dailyCap: 1.5 }, { defaultLeadMinutes: -1 }, { defaultLeadMinutes: 10081 },
      { quietStart: '24:00' }, { quietStart: '7:5' }, { quietEnd: '25:61' }, { nope: 1 }])
      expect((await put(bad)).statusCode, JSON.stringify(bad)).toBe(400)
    expect((await put({ defaultLeadMinutes: 0, dailyCap: 100, quietStart: '00:00', quietEnd: '23:59' })).statusCode).toBe(200)
  })
})
