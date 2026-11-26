import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Kysely } from 'kysely'
import { testDb } from './helpers/testDb.js'
import type { Schema } from '../src/db/schema.js'
import { addEvent, addTask, listToday, occurrencesBetween } from '../src/planner/planner.js'

let db: Kysely<Schema>
beforeAll(async () => { db = await testDb() })
afterAll(async () => { await db.destroy() })
beforeEach(async () => {
  await db.deleteFrom('events').execute()
  await db.deleteFrom('tasks').execute()
})
const d = (s: string) => new Date(s)
// Wed 2026-11-18 08:00 Bangkok = 01:00Z
const WED = d('2026-11-18T01:00:00Z')

describe('occurrencesBetween', () => {
  it('non-repeating: one occurrence inside the range, none outside', () => {
    const e = { startsAt: WED, repeatWeekly: false }
    expect(occurrencesBetween(e, d('2026-11-18T00:00:00Z'), d('2026-11-19T00:00:00Z'))).toEqual([WED])
    expect(occurrencesBetween(e, d('2026-11-19T00:00:00Z'), d('2026-11-30T00:00:00Z'))).toEqual([])
  })
  it('weekly: three weeks gives three Wednesdays 08:00 Bangkok', () => {
    const r = occurrencesBetween({ startsAt: WED, repeatWeekly: true }, d('2026-11-18T00:00:00Z'), d('2026-12-09T00:00:00Z'))
    expect(r.map((x) => x.toISOString())).toEqual(['2026-11-18T01:00:00.000Z', '2026-11-25T01:00:00.000Z', '2026-12-02T01:00:00.000Z'])
  })
  it('weekly: from inclusive, to exclusive, never before startsAt', () => {
    const e = { startsAt: WED, repeatWeekly: true }
    expect(occurrencesBetween(e, d('2026-11-25T01:00:00Z'), d('2026-12-02T01:00:00Z'))).toEqual([d('2026-11-25T01:00:00Z')])
    expect(occurrencesBetween(e, d('2026-10-01T00:00:00Z'), d('2026-11-18T01:00:00Z'))).toEqual([])
    expect(occurrencesBetween(e, d('2026-10-01T00:00:00Z'), d('2026-11-19T00:00:00Z'))).toEqual([WED])
  })
})

describe('listToday', () => {
  const now = d('2026-11-25T03:00:00Z') // Wed 10:00 Bangkok
  const ev = (title: string, startsAt: string, repeatWeekly = false) =>
    addEvent(db, { title, kind: 'class', startsAt: d(startsAt), repeatWeekly })

  it('weekly class started in the past shows today at the same Bangkok time, only on its weekday', async () => {
    const { id } = await ev('เรียน', '2026-11-04T01:00:00Z', true)
    expect(typeof id).toBe('number')
    expect(await listToday(db, now)).toEqual([{ kind: 'event', id, title: 'เรียน', at: d('2026-11-25T01:00:00Z') }])
    expect(await listToday(db, d('2026-11-26T03:00:00Z'))).toEqual([])
  })
  it('weekly event does not appear before its start', async () => {
    await ev('later', '2026-12-02T01:00:00Z', true)
    expect(await listToday(db, now)).toEqual([])
  })
  it('Bangkok midnight edge: 23:30 today in, 00:10 tomorrow out', async () => {
    const a = await ev('late', '2026-11-25T16:30:00Z') // 23:30 Bangkok today
    await ev('next', '2026-11-25T17:10:00Z') // 00:10 Bangkok tomorrow
    await ev('prev', '2026-11-24T16:59:00Z') // 23:59 Bangkok yesterday
    expect((await listToday(db, now)).map((x) => x.id)).toEqual([a.id])
  })
  it('includes todo tasks due today; excludes done, deleted, other days; sorted with null at last', async () => {
    const t1 = await addTask(db, { title: 't1', priority: 2, dueAt: d('2026-11-25T05:00:00Z') })
    const e1 = await ev('e1', '2026-11-25T02:00:00Z')
    const done = await addTask(db, { title: 'done', priority: 1, dueAt: d('2026-11-25T04:00:00Z') })
    const del = await addTask(db, { title: 'del', priority: 1, dueAt: d('2026-11-25T04:00:00Z') })
    const ed = await ev('edel', '2026-11-25T04:00:00Z')
    await addTask(db, { title: 'tomorrow', priority: 1, dueAt: d('2026-11-26T05:00:00Z') })
    await addTask(db, { title: 'nodue', priority: 1 })
    await db.updateTable('tasks').set({ status: 'done' }).where('id', '=', done.id).execute()
    await db.updateTable('tasks').set({ deleted_at: now }).where('id', '=', del.id).execute()
    await db.updateTable('events').set({ deleted_at: now }).where('id', '=', ed.id).execute()
    const r = await listToday(db, now)
    expect(r.map((x) => [x.kind, x.id])).toEqual([['event', e1.id], ['task', t1.id]])
    expect(r.every((x) => typeof x.id === 'number')).toBe(true)
  })
})
