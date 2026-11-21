import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Kysely } from 'kysely'
import { testDb } from './helpers/testDb.js'
import { FakeSender } from './helpers/push.js'
import type { Schema } from '../src/db/schema.js'
import { buildApp } from '../src/app.js'
import { hashPassword } from '../src/auth/auth.js'
import { dispatchDue, WebPushSender } from '../src/push/push.js'
import { DEFAULT_REMINDER_SETTINGS as S, planReminders } from '../src/reminders/reminders.js'

let db: Kysely<Schema>
beforeAll(async () => { db = await testDb() })
afterAll(async () => { await db.destroy() })
const T = new Date('2026-11-25T03:00:00Z') // 10:00 Bangkok
const sub = (n: number) => ({ endpoint: `https://push.example/${n}`, p256dh: `p${n}`, auth: `a${n}` })
const addSubs = async (...ns: number[]) => { for (const n of ns) await db.insertInto('push_subscriptions').values(sub(n)).execute() }
const addEvent = async (title: string, startsAt: string, lead = 30) =>
  Number((await db.insertInto('events').values({ title, kind: 'class', starts_at: new Date(startsAt), repeat_weekly: false, lead_minutes: lead }).executeTakeFirstOrThrow()).insertId)
const addCategory = async (name: string) => Number((await db.insertInto('categories').values({ name, kind: 'expense' }).executeTakeFirstOrThrow()).insertId)
const reminder = () => db.selectFrom('reminders').selectAll().executeTakeFirstOrThrow()
beforeEach(async () => {
  for (const t of ['push_subscriptions', 'reminders', 'events', 'transactions', 'budgets', 'categories'] as const) await db.deleteFrom(t).execute()
})

describe('dispatchDue', () => {
  it('sends once, sets sent_at, does not resend; exact payload + ttl', async () => {
    await addSubs(1)
    await addEvent('ฟิสิกส์', '2026-11-25T03:30:00Z')
    await planReminders(db, T, S)
    const f = new FakeSender()
    expect(await dispatchDue(db, T, f, S)).toEqual({ sent: 1, failed: 0 })
    expect(f.calls).toEqual([{ sub: expect.objectContaining({ endpoint: sub(1).endpoint }), payload: { title: 'ฟิสิกส์', body: 'อีก 30 นาที', url: '/' }, ttl: 120 }])
    expect((await reminder()).sent_at).toEqual(T)
    expect(await dispatchDue(db, new Date(T.getTime() + 60_000), f, S)).toEqual({ sent: 0, failed: 0 })
    expect(f.calls.length).toBe(1)
  })
  it('Thai bodies: now and already started', async () => {
    await addSubs(1)
    await addEvent('A', '2026-11-25T03:00:00Z', 0)
    await planReminders(db, T, S)
    const f = new FakeSender()
    await dispatchDue(db, T, f, S)
    expect(f.calls[0]!.payload.body).toBe('ถึงเวลาแล้ว')
    await db.updateTable('reminders').set({ sent_at: null }).execute()
    await dispatchDue(db, new Date(T.getTime() + 60_000), f, S)
    expect(f.calls[1]!.payload.body).toBe('เริ่มไปแล้ว 1 นาที')
  })
  it('budget payload, ttl 3600', async () => {
    await addSubs(1)
    const id = await addCategory('อาหาร')
    await db.insertInto('reminders').values({ kind: 'budget', ref_id: id, dedupe_key: 'b', fire_at: T, level: 80, attempts: 0 }).execute()
    const f = new FakeSender()
    await dispatchDue(db, T, f, S)
    expect(f.calls[0]).toMatchObject({ payload: { title: 'งบประมาณ', body: 'งบหมวด อาหาร ถึง 80%', url: '/' }, ttl: 3600 })
  })
  it('one ok + one retry marks sent (no duplicate next tick)', async () => {
    await addSubs(1, 2)
    await addEvent('A', '2026-11-25T03:30:00Z')
    await planReminders(db, T, S)
    const f = new FakeSender(); f.outcomes[sub(2).endpoint] = 'retry'
    expect(await dispatchDue(db, T, f, S)).toEqual({ sent: 1, failed: 0 })
    await dispatchDue(db, new Date(T.getTime() + 60_000), f, S)
    expect(f.calls.length).toBe(2)
  })
  it('all retry: attempts increment, due again, abandoned after 3 with one log', async () => {
    await addSubs(1)
    await addEvent('A', '2026-11-25T03:30:00Z')
    await planReminders(db, T, S)
    const f = new FakeSender(); f.outcomes[sub(1).endpoint] = 'retry'
    const logs: string[] = []
    for (let i = 0; i < 4; i++) {
      const r = await dispatchDue(db, new Date(T.getTime() + i * 60_000), f, S, (m) => logs.push(m))
      expect(r).toEqual({ sent: 0, failed: i < 3 ? 1 : 0 })
    }
    expect(f.calls.length).toBe(3)
    expect((await reminder()).attempts).toBe(3)
    expect(logs.length).toBe(1)
    expect(logs[0]).toContain(String((await reminder()).id))
    expect(logs[0]).not.toContain('push.example')
  })
  it('gone deletes only that subscription, not an attempt', async () => {
    await addSubs(1, 2)
    await addEvent('A', '2026-11-25T03:30:00Z')
    await planReminders(db, T, S)
    const f = new FakeSender(); f.outcomes[sub(1).endpoint] = 'gone'
    expect(await dispatchDue(db, T, f, S)).toEqual({ sent: 1, failed: 0 })
    expect((await db.selectFrom('push_subscriptions').select('endpoint').execute()).map((r) => r.endpoint)).toEqual([sub(2).endpoint])
    expect((await reminder()).attempts).toBe(0)
  })
  it('all gone: reminder untouched; zero subscriptions: untouched and still due', async () => {
    await addSubs(1)
    await addEvent('A', '2026-11-25T03:30:00Z')
    await planReminders(db, T, S)
    const f = new FakeSender(); f.outcomes[sub(1).endpoint] = 'gone'
    expect(await dispatchDue(db, T, f, S)).toEqual({ sent: 0, failed: 0 })
    expect(await dispatchDue(db, T, f, S)).toEqual({ sent: 0, failed: 0 })
    expect(f.calls.length).toBe(1)
    expect(await reminder()).toMatchObject({ attempts: 0, sent_at: null })
    await addSubs(3)
    expect(await dispatchDue(db, T, f, S)).toEqual({ sent: 1, failed: 0 })
  })
  it('budget deferred in quiet hours, sent after; events ignore quiet hours', async () => {
    await addSubs(1)
    const id = await addCategory('อาหาร')
    await db.insertInto('reminders').values({ kind: 'budget', ref_id: id, dedupe_key: 'b', fire_at: new Date('2026-11-25T16:00:00Z'), level: 80, attempts: 0 }).execute()
    const f = new FakeSender()
    const night = new Date('2026-11-25T16:30:00Z') // 23:30 Bangkok
    expect(await dispatchDue(db, night, f, S)).toEqual({ sent: 0, failed: 0 })
    expect(f.calls.length).toBe(0)
    expect(await dispatchDue(db, new Date('2026-11-26T00:30:00Z'), f, S)).toEqual({ sent: 1, failed: 0 })
    const ev = await addEvent('E', '2026-11-25T16:40:00Z', 10)
    await planReminders(db, night, S)
    expect(await dispatchDue(db, night, f, S)).toEqual({ sent: 1, failed: 0 })
    expect(ev).toBeGreaterThan(0)
  })
})

describe('WebPushSender', () => {
  const vapid = { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:a@b.c' }
  const payload = { title: 't', body: 'b', url: '/' }
  const run = (impl: () => Promise<unknown>, ttl?: number) => {
    const calls: unknown[][] = []
    return new WebPushSender(vapid, async (...a) => { calls.push(a); return impl() }).send(sub(1), payload, { ttl }).then((r) => ({ r, calls }))
  }
  it('ok with payload string and options', async () => {
    const { r, calls } = await run(async () => ({ statusCode: 201 }))
    expect(r).toBe('ok')
    expect(calls[0]).toEqual([{ endpoint: sub(1).endpoint, keys: { p256dh: 'p1', auth: 'a1' } }, JSON.stringify(payload), expect.objectContaining({ TTL: 120, urgency: 'high', timeout: 10_000 })])
    expect((await run(async () => ({}), 3600)).calls[0]![2]).toMatchObject({ TTL: 3600 })
  })
  it.each([404, 410])('%i -> gone', async (statusCode) => {
    expect((await run(() => Promise.reject(Object.assign(new Error('x'), { statusCode })))).r).toBe('gone')
  })
  it.each([500, 400, 429])('%i -> retry', async (statusCode) => {
    expect((await run(() => Promise.reject(Object.assign(new Error('x'), { statusCode })))).r).toBe('retry')
  })
  it('network error / timeout -> retry', async () => {
    expect((await run(() => Promise.reject(new Error('ETIMEDOUT')))).r).toBe('retry')
  })
})

describe('push routes', () => {
  let app: ReturnType<typeof buildApp>
  let cookies: Record<string, string>
  const sender = new FakeSender()
  beforeAll(async () => {
    app = buildApp({ db, ownerPasswordHash: await hashPassword('pw'), sessionSecret: 'test-secret-test-secret', sender, vapidPublicKey: 'PUBKEY' })
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'pw' } })
    cookies = { [res.cookies[0]!.name]: res.cookies[0]!.value }
  })
  afterAll(async () => { await app.close() })
  const call = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as object, cookies })
  const body = (n: number, extra = {}) => ({ endpoint: sub(n).endpoint, expirationTime: null, keys: { p256dh: `p${n}`, auth: `a${n}` }, ...extra })

  it('401 without a session', async () => {
    for (const [method, url] of [['GET', '/push/vapid-key'], ['POST', '/push/subscribe'], ['DELETE', '/push/subscribe'], ['POST', '/push/test']] as const)
      expect((await app.inject({ method, url })).statusCode).toBe(401)
  })
  it('vapid-key', async () => {
    expect((await call('GET', '/push/vapid-key')).json()).toEqual({ key: 'PUBKEY' })
  })
  it('subscribe validation', async () => {
    expect((await call('POST', '/push/subscribe', body(1, { endpoint: 'http://push.example/1' }))).statusCode).toBe(400)
    expect((await call('POST', '/push/subscribe', { endpoint: sub(1).endpoint })).statusCode).toBe(400)
    expect((await call('POST', '/push/subscribe', { endpoint: sub(1).endpoint, keys: { p256dh: 'x' } })).statusCode).toBe(400)
    expect((await call('POST', '/push/subscribe')).statusCode).toBe(400)
  })
  it('subscribe twice upserts; delete is idempotent', async () => {
    expect((await call('POST', '/push/subscribe', body(1))).json()).toEqual({ ok: true })
    expect((await call('POST', '/push/subscribe', { ...body(1), keys: { p256dh: 'new', auth: 'newa' } })).statusCode).toBe(200)
    expect(await db.selectFrom('push_subscriptions').select(['p256dh', 'auth']).execute()).toEqual([{ p256dh: 'new', auth: 'newa' }])
    expect((await call('DELETE', '/push/subscribe', { endpoint: sub(1).endpoint })).statusCode).toBe(204)
    expect((await call('DELETE', '/push/subscribe', { endpoint: sub(1).endpoint })).statusCode).toBe(204)
    expect((await call('DELETE', '/push/subscribe', {})).statusCode).toBe(400)
    expect(await db.selectFrom('push_subscriptions').selectAll().execute()).toEqual([])
  })
  it('test: none -> 0; sends to all, removes gone', async () => {
    expect((await call('POST', '/push/test')).json()).toEqual({ sent: 0 })
    for (const n of [1, 2, 3]) await call('POST', '/push/subscribe', body(n))
    sender.calls = []; sender.outcomes = { [sub(2).endpoint]: 'gone', [sub(3).endpoint]: 'retry' }
    expect((await call('POST', '/push/test')).json()).toEqual({ sent: 1 })
    expect(sender.calls.map((c) => c.payload)).toEqual(Array(3).fill({ title: 'live os', body: 'ทดสอบการแจ้งเตือน', url: '/' }))
    expect((await db.selectFrom('push_subscriptions').select('endpoint').orderBy('id').execute()).map((r) => r.endpoint)).toEqual([sub(1).endpoint, sub(3).endpoint])
  })
})
