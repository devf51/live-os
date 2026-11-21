import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Kysely } from 'kysely'
import { testDb } from './helpers/testDb.js'
import type { Schema } from '../src/db/schema.js'
import { buildApp } from '../src/app.js'
import { testPush } from './helpers/push.js'
import { hashPassword } from '../src/auth/auth.js'
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

describe('routes', () => {
  let app: ReturnType<typeof buildApp>
  let cookies: Record<string, string>
  beforeAll(async () => {
    app = buildApp({ db, ownerPasswordHash: await hashPassword('pw'), sessionSecret: 'test-secret-test-secret', ...testPush, now: () => d('2026-11-25T03:00:00Z') })
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'pw' } })
    cookies = { [res.cookies[0]!.name]: res.cookies[0]!.value }
  })
  afterAll(async () => { await app.close() })
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) => app.inject({ method, url, payload, cookies })

  it('401 without a session', async () => {
    for (const u of ['/events', '/tasks', '/today']) expect((await app.inject({ url: u })).statusCode).toBe(401)
  })
  it('event CRUD with exact JSON types', async () => {
    const c = await call('POST', '/events', { title: 'คลาส', kind: 'class', startsAt: '2026-11-18T01:00:00Z', repeatWeekly: true, leadMinutes: 30 })
    expect(c.statusCode).toBe(201)
    const { id } = c.json()
    expect((await call('GET', '/events')).json()).toEqual([
      { id, title: 'คลาส', kind: 'class', startsAt: '2026-11-18T01:00:00.000Z', endsAt: null, repeatWeekly: true, leadMinutes: 30 },
    ])
    expect((await call('PATCH', `/events/${id}`, { title: 'x', repeatWeekly: false })).statusCode).toBe(200)
    expect((await call('GET', '/events')).json()[0]).toMatchObject({ title: 'x', repeatWeekly: false })
    expect((await call('DELETE', `/events/${id}`)).statusCode).toBe(204)
    expect((await call('GET', '/events')).json()).toEqual([])
    expect((await call('DELETE', `/events/${id}`)).statusCode).toBe(404)
    expect((await call('PATCH', `/events/${id}`, { title: 'y' })).statusCode).toBe(404)
  })
  it('event validation: 400', async () => {
    const ok = { title: 't', kind: 'class', startsAt: '2026-11-18T01:00:00Z' }
    for (const bad of [{ ...ok, title: '' }, { ...ok, kind: 'x' }, { ...ok, startsAt: 'nope' }, { ...ok, endsAt: '2026-11-18T00:00:00Z' }, { ...ok, leadMinutes: 10081 }, { ...ok, leadMinutes: 1.5 }]) {
      expect((await call('POST', '/events', bad)).statusCode).toBe(400)
    }
    const { id } = (await call('POST', '/events', { ...ok, repeatWeekly: false })).json()
    expect((await call('PATCH', `/events/${id}`, { endsAt: '2026-11-18T00:00:00Z' })).statusCode).toBe(400)
    expect((await call('PATCH', `/events/${id}`, { bogus: 1 })).statusCode).toBe(400)
  })
  it('task CRUD, status filter, validation', async () => {
    const { id } = (await call('POST', '/tasks', { title: 'จ่ายค่าเช่า', priority: 2, dueAt: '2026-11-25T05:00:00Z' })).json()
    expect((await call('GET', '/tasks')).json()).toEqual([{ id, title: 'จ่ายค่าเช่า', priority: 2, dueAt: '2026-11-25T05:00:00.000Z', status: 'todo' }])
    expect((await call('POST', '/tasks', { title: 'a', priority: 5 })).statusCode).toBe(400)
    expect((await call('PATCH', `/tasks/${id}`, { status: 'done' })).statusCode).toBe(200)
    expect((await call('GET', '/tasks?status=todo')).json()).toEqual([])
    expect((await call('GET', '/tasks?status=done')).json()).toHaveLength(1)
    expect((await call('GET', '/tasks?status=zzz')).statusCode).toBe(400)
    expect((await call('DELETE', `/tasks/${id}`)).statusCode).toBe(204)
    expect((await call('GET', '/tasks')).json()).toEqual([])
    expect((await call('PATCH', `/tasks/${id}`, { title: 'q' })).statusCode).toBe(404)
  })
  it('GET /today exact shape', async () => {
    const e = (await call('POST', '/events', { title: 'e', kind: 'appointment', startsAt: '2026-11-25T02:00:00Z' })).json()
    const t = (await call('POST', '/tasks', { title: 't', priority: 1, dueAt: '2026-11-25T01:00:00Z' })).json()
    const n = (await call('POST', '/tasks', { title: 'n', priority: 1 })).json()
    expect(n.id).toBeTypeOf('number')
    expect((await call('GET', '/today')).json()).toEqual([
      { kind: 'task', id: t.id, title: 't', at: '2026-11-25T01:00:00.000Z' },
      { kind: 'event', id: e.id, title: 'e', at: '2026-11-25T02:00:00.000Z' },
    ])
  })
})
