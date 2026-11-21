import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Kysely } from 'kysely'
import { testDb } from './helpers/testDb.js'
import type { Schema } from '../src/db/schema.js'
import { buildApp } from '../src/app.js'
import { testPush } from './helpers/push.js'
import { hashPassword } from '../src/auth/auth.js'
import { addHabit, currentStreak, deleteHabit, findHabitByName, habitsDue, logHabit, unlogHabit } from '../src/habits/habits.js'

let db: Kysely<Schema>
beforeAll(async () => { db = await testDb() })
afterAll(async () => { await db.destroy() })
beforeEach(async () => {
  await db.deleteFrom('habit_logs').execute()
  await db.deleteFrom('habits').execute()
})
// 2026-11-18 is a Wednesday; week = Mon 11-16 .. Sun 11-22
const daily = (name = 'd') => addHabit(db, { name, freqType: 'daily', freqValue: '' })
const TODAY = '2026-12-31' // far enough ahead that fixture days are never in the future
const logs = async (id: number, days: string[]) => { for (const d of days) await logHabit(db, id, d, TODAY) }
const due = async (day: string) => (await habitsDue(db, day)).map((h) => `${h.name}${h.done ? '*' : ''}`)

describe('habitsDue', () => {
  it('daily shows every day, done flips with a log', async () => {
    const { id } = await daily()
    expect(await habitsDue(db, '2026-11-18')).toEqual([{ id, name: 'd', done: false }])
    await logHabit(db, id, '2026-11-18', TODAY)
    expect(await habitsDue(db, '2026-11-18')).toEqual([{ id, name: 'd', done: true }])
    expect(await due('2026-11-19')).toEqual(['d'])
  })
  it('weekdays 1,3,5 only Mon/Wed/Fri', async () => {
    await addHabit(db, { name: 'w', freqType: 'weekdays', freqValue: '5,1,3' })
    expect((await db.selectFrom('habits').select('freq_value').executeTakeFirstOrThrow()).freq_value).toBe('1,3,5')
    expect(await due('2026-11-16')).toEqual(['w']) // Mon
    expect(await due('2026-11-17')).toEqual([]) // Tue
    expect(await due('2026-11-18')).toEqual(['w'])
    expect(await due('2026-11-19')).toEqual([])
    expect(await due('2026-11-20')).toEqual(['w'])
    expect(await due('2026-11-21')).toEqual([])
    expect(await due('2026-11-22')).toEqual([]) // Sun
  })
  it('per_week 3: due until target reached, stays (done) the day it completes, gone afterwards', async () => {
    const { id } = await addHabit(db, { name: 'p', freqType: 'per_week', freqValue: '3' })
    await logs(id, ['2026-11-16', '2026-11-17'])
    expect(await due('2026-11-18')).toEqual(['p'])
    await logHabit(db, id, '2026-11-18', TODAY)
    expect(await due('2026-11-18')).toEqual(['p*'])
    expect(await due('2026-11-19')).toEqual([])
    expect(await due('2026-11-22')).toEqual([])
    expect(await due('2026-11-23')).toEqual(['p']) // next ISO week
  })
  it('soft-deleted habits are excluded', async () => {
    const { id } = await daily()
    await db.updateTable('habits').set({ deleted_at: new Date() }).where('id', '=', id).execute()
    expect(await habitsDue(db, '2026-11-18')).toEqual([])
  })
})

describe('logHabit', () => {
  it('is idempotent', async () => {
    const { id } = await daily()
    await logHabit(db, id, '2026-11-18', TODAY)
    await logHabit(db, id, '2026-11-18', TODAY)
    expect(await db.selectFrom('habit_logs').selectAll().execute()).toHaveLength(1)
  })
  it('rejects unknown / deleted habit and invalid days', async () => {
    await expect(logHabit(db, 999, '2026-11-18', TODAY)).rejects.toMatchObject({ code: 'not_found' })
    const { id } = await daily()
    await expect(logHabit(db, id, '2026-02-30', TODAY)).rejects.toMatchObject({ code: 'invalid' })
    await db.updateTable('habits').set({ deleted_at: new Date() }).where('id', '=', id).execute()
    await expect(logHabit(db, id, '2026-11-18', TODAY)).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('logHabit future guard', () => {
  it('today and past ok; future rejected without a row; invalid today rejected; double log fine', async () => {
    const { id } = await daily()
    await logHabit(db, id, '2026-11-18', '2026-11-18')
    await logHabit(db, id, '2026-11-18', '2026-11-18')
    await logHabit(db, id, '2026-11-10', '2026-11-18')
    await expect(logHabit(db, id, '2026-11-19', '2026-11-18')).rejects.toMatchObject({ code: 'invalid' })
    await expect(logHabit(db, id, '2026-11-18', 'nope')).rejects.toMatchObject({ code: 'invalid' })
    expect(await db.selectFrom('habit_logs').selectAll().execute()).toHaveLength(2)
  })
})

describe('addHabit validation', () => {
  const bad = (freqType: 'daily' | 'per_week' | 'weekdays', freqValue: string, name = 'x') =>
    expect(addHabit(db, { name, freqType, freqValue })).rejects.toMatchObject({ code: 'invalid' })
  it('rejects bad names and frequencies', async () => {
    await bad('daily', '3'); await bad('per_week', ''); await bad('per_week', '0'); await bad('per_week', '8'); await bad('per_week', '2.5')
    await bad('weekdays', ''); await bad('weekdays', '0,1'); await bad('weekdays', '1,1'); await bad('weekdays', '8')
    await bad('daily', '', '   '); await bad('daily', '', 'x'.repeat(101))
  })
})

describe('currentStreak', () => {
  it('daily: 3 consecutive days ending today = 3; ending yesterday still 3; gap = 0', async () => {
    const { id } = await daily()
    await logs(id, ['2026-11-16', '2026-11-17', '2026-11-18'])
    expect(await currentStreak(db, id, '2026-11-18')).toBe(3)
    expect(await currentStreak(db, id, '2026-11-19')).toBe(3) // today-grace
    expect(await currentStreak(db, id, '2026-11-20')).toBe(0)
  })
  it('daily: a hole breaks the streak', async () => {
    const { id } = await daily()
    await logs(id, ['2026-11-14', '2026-11-16', '2026-11-17'])
    expect(await currentStreak(db, id, '2026-11-17')).toBe(2)
  })
  it('weekdays: non-scheduled days are skipped, missed scheduled day breaks', async () => {
    const { id } = await addHabit(db, { name: 'w', freqType: 'weekdays', freqValue: '1,3,5' })
    await logs(id, ['2026-11-09', '2026-11-11', '2026-11-13', '2026-11-16', '2026-11-18'])
    expect(await currentStreak(db, id, '2026-11-18')).toBe(5)
    expect(await currentStreak(db, id, '2026-11-19')).toBe(5) // Thu not scheduled
    expect(await currentStreak(db, id, '2026-11-20')).toBe(5) // Fri scheduled, unlogged today: grace
    expect(await currentStreak(db, id, '2026-11-21')).toBe(0) // Fri missed
    expect(await currentStreak(db, id, '2026-11-14')).toBe(3) // Sat, ends Fri 11-13
  })
  it('per_week 2: consecutive weeks meeting target, current week may still be open', async () => {
    const { id } = await addHabit(db, { name: 'p', freqType: 'per_week', freqValue: '2' })
    await logs(id, ['2026-11-02', '2026-11-04', '2026-11-09', '2026-11-10', '2026-11-16'])
    expect(await currentStreak(db, id, '2026-11-18')).toBe(2) // current week 1/2, previous two met
    await logHabit(db, id, '2026-11-17', TODAY)
    expect(await currentStreak(db, id, '2026-11-18')).toBe(3)
    expect(await currentStreak(db, id, '2026-11-30')).toBe(0) // current and previous week empty
  })
  it('per_week: week boundary is Bangkok Sunday->Monday', async () => {
    const { id } = await addHabit(db, { name: 'p', freqType: 'per_week', freqValue: '2' })
    // Sun 23:30 Bangkok (16:30Z) and Mon 00:10 Bangkok (Sun 17:10Z) are different weeks
    await logs(id, ['2026-11-22', '2026-11-23'])
    expect(await currentStreak(db, id, '2026-11-23')).toBe(0)
    await logHabit(db, id, '2026-11-21', TODAY)
    expect(await currentStreak(db, id, '2026-11-23')).toBe(1)
  })
  it('0 for deleted/unknown habit logs', async () => {
    expect(await currentStreak(db, 12345, '2026-11-18')).toBe(0)
  })
})

describe('habit routes', () => {
  let app: ReturnType<typeof buildApp>
  let cookies: Record<string, string>
  // Sun 2026-11-22 23:30 Bangkok: UTC date is still the 22nd; Bangkok day is 2026-11-22. Use Wed 10:00 instead for simplicity.
  beforeAll(async () => {
    app = buildApp({ db, ownerPasswordHash: await hashPassword('pw'), sessionSecret: 'test-secret-test-secret', ...testPush, now: () => new Date('2026-11-18T03:00:00Z') })
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'pw' } })
    cookies = { [res.cookies[0]!.name]: res.cookies[0]!.value }
  })
  afterAll(async () => { await app.close() })
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) => app.inject({ method, url, payload, cookies })

  it('401 without a session', async () => {
    expect((await app.inject({ url: '/habits' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/habits/1/logs' })).statusCode).toBe(401)
  })
  it('create, list due today with exact JSON, log today with empty body, idempotent', async () => {
    const c = await call('POST', '/habits', { name: '  วิ่ง  ', freqType: 'daily', freqValue: '' })
    expect(c.statusCode).toBe(201)
    const { id } = c.json()
    expect(typeof id).toBe('number')
    expect(JSON.parse((await call('GET', '/habits')).payload)).toEqual([{ id, name: 'วิ่ง', done: false }])
    expect((await app.inject({ method: 'POST', url: `/habits/${id}/logs`, cookies })).json()).toEqual({ ok: true })
    expect((await call('POST', `/habits/${id}/logs`, {})).statusCode).toBeLessThan(300)
    expect(JSON.parse((await call('GET', '/habits')).payload)).toEqual([{ id, name: 'วิ่ง', done: true }])
    expect(await db.selectFrom('habit_logs').selectAll().execute()).toHaveLength(1)
  })
  it('log with explicit past day ok; future / invalid day 400; unknown 404', async () => {
    const { id } = (await call('POST', '/habits', { name: 'a', freqType: 'daily', freqValue: '' })).json()
    expect((await call('POST', `/habits/${id}/logs`, { day: '2026-11-10' })).statusCode).toBeLessThan(300)
    expect((await call('POST', `/habits/${id}/logs`, { day: '2026-11-18' })).statusCode).toBeLessThan(300)
    expect((await call('POST', `/habits/${id}/logs`, { day: '2026-11-19' })).statusCode).toBe(400)
    expect((await call('POST', `/habits/${id}/logs`, { day: '2026-02-30' })).statusCode).toBe(400)
    expect((await call('POST', `/habits/${id}/logs`, { day: 'x' })).statusCode).toBe(400)
    expect((await call('POST', '/habits/99999/logs')).statusCode).toBe(404)
    expect((await call('POST', '/habits/abc/logs')).statusCode).toBe(400)
  })
  it('POST validation 400', async () => {
    for (const b of [
      { name: '', freqType: 'daily', freqValue: '' }, { name: 'x'.repeat(101), freqType: 'daily', freqValue: '' },
      { name: 'x', freqType: 'monthly', freqValue: '' }, { name: 'x', freqType: 'per_week', freqValue: '9' },
      { name: 'x', freqType: 'weekdays', freqValue: '1,1' }, { name: 'x', freqType: 'daily', freqValue: '1' },
      { name: 'x', freqType: 'daily' },
    ]) expect((await call('POST', '/habits', b)).statusCode).toBe(400)
  })
  it('PATCH name/frequency, validated against the merged state; DELETE soft-deletes', async () => {
    const { id } = (await call('POST', '/habits', { name: 'a', freqType: 'daily', freqValue: '' })).json()
    expect((await call('PATCH', `/habits/${id}`, { name: 'b' })).statusCode).toBe(200)
    expect((await call('PATCH', `/habits/${id}`, { freqType: 'per_week' })).statusCode).toBe(400) // '' invalid for per_week
    expect((await call('PATCH', `/habits/${id}`, { freqType: 'per_week', freqValue: '2' })).statusCode).toBe(200)
    expect((await call('PATCH', '/habits/99999', { name: 'z' })).statusCode).toBe(404)
    expect((await call('GET', '/habits')).json()).toEqual([{ id, name: 'b', done: false }])
    expect((await call('DELETE', `/habits/${id}`)).statusCode).toBe(204)
    expect((await call('GET', '/habits')).json()).toEqual([])
    expect((await call('DELETE', `/habits/${id}`)).statusCode).toBe(404)
    expect((await call('PATCH', `/habits/${id}`, { name: 'z' })).statusCode).toBe(404)
    expect((await call('POST', `/habits/${id}/logs`)).statusCode).toBe(404)
  })
  it('"today" is the Bangkok day: Sun 23:30 -> Sun, Mon 00:10 -> Mon (server zone +07:00)', async () => {
    const { id } = (await call('POST', '/habits', { name: 'a', freqType: 'daily', freqValue: '' })).json()
    for (const now of ['2026-11-22T16:30:00Z', '2026-11-22T17:10:00Z']) {
      const a = buildApp({ db, ownerPasswordHash: await hashPassword('pw'), sessionSecret: 'test-secret-test-secret', ...testPush, now: () => new Date(now) })
      const login = await a.inject({ method: 'POST', url: '/auth/login', payload: { password: 'pw' } })
      const c = { [login.cookies[0]!.name]: login.cookies[0]!.value }
      expect((await a.inject({ method: 'POST', url: `/habits/${id}/logs`, cookies: c })).statusCode).toBe(200)
      await a.close()
    }
    expect((await db.selectFrom('habit_logs').select('day').orderBy('day').execute()).map((r) => r.day)).toEqual(['2026-11-22', '2026-11-23'])
  })
})

describe('findHabitByName / unlogHabit', () => {
  it('matches trimmed, case-insensitive, non-deleted; first id wins', async () => {
    await db.deleteFrom('habit_logs').execute()
    await db.deleteFrom('habits').execute()
    const a = await addHabit(db, { name: 'Gym', freqType: 'daily', freqValue: '' })
    await addHabit(db, { name: 'gym', freqType: 'daily', freqValue: '' })
    expect(await findHabitByName(db, '  GYM ')).toEqual({ id: a.id, name: 'Gym' })
    await deleteHabit(db, a.id)
    expect((await findHabitByName(db, 'gym'))!.id).not.toBe(a.id)
    expect(await findHabitByName(db, 'nope')).toBeNull()
  })
  it('unlogHabit removes only that day', async () => {
    await db.deleteFrom('habit_logs').execute()
    const h = await addHabit(db, { name: 'Run', freqType: 'daily', freqValue: '' })
    await logHabit(db, h.id, '2026-11-20', '2026-11-21')
    await logHabit(db, h.id, '2026-11-21', '2026-11-21')
    await unlogHabit(db, h.id, '2026-11-21')
    expect((await db.selectFrom('habit_logs').select('day').execute()).map((r) => r.day)).toEqual(['2026-11-20'])
  })
})
