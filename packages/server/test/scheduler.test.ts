import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Kysely } from 'kysely'
import { testDb } from './helpers/testDb.js'
import { FakeSender } from './helpers/push.js'
import type { Schema } from '../src/db/schema.js'
import { startScheduler } from '../src/reminders/scheduler.js'

let db: Kysely<Schema>
beforeAll(async () => { db = await testDb() })
afterAll(async () => { await db.destroy() })
const T = new Date('2026-11-25T03:00:00Z')
beforeEach(async () => {
  for (const t of ['push_subscriptions', 'reminders', 'events'] as const) await db.deleteFrom(t).execute()
  await db.insertInto('push_subscriptions').values({ endpoint: 'https://push.example/1', p256dh: 'p', auth: 'a' }).execute()
  await db.insertInto('events').values({ title: 'A', kind: 'class', starts_at: new Date('2026-11-25T03:30:00Z'), repeat_weekly: false, lead_minutes: 30 }).execute()
})
afterEach(() => { vi.useRealTimers() })

/** let real async DB work finish while fake timers are installed */
const settle = () => vi.waitFor(async () => { await Promise.resolve() })
const until = (f: () => boolean) => vi.waitFor(() => { if (!f()) throw new Error('pending') }, { timeout: 5000, interval: 10 })

describe('startScheduler', () => {
  it('ticks immediately, then on the interval; stop() ends it', async () => {
    const sender = new FakeSender()
    const now = vi.fn(() => T)
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const s = startScheduler({ db, sender, now, intervalMs: 1000 })
    await until(() => sender.calls.length === 1) // immediate catch-up tick sent the due reminder
    expect((await db.selectFrom('reminders').select('sent_at').executeTakeFirstOrThrow()).sent_at).toEqual(T)
    await until(() => now.mock.calls.length === 1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(now.mock.calls.length).toBe(2)
    expect(sender.calls.length).toBe(1) // nothing new, nothing resent
    s.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(now.mock.calls.length).toBe(2)
  })
  it('never overlaps: a slow tick makes later intervals skip', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    let started = 0
    const sender = new FakeSender()
    vi.spyOn(sender, 'send').mockImplementation(async () => { started++; await gate; return 'ok' })
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const s = startScheduler({ db, sender, now: () => T, intervalMs: 1000 })
    await until(() => started === 1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(started).toBe(1)
    release()
    await settle()
    s.stop()
  })
  it('an error in a tick is logged and the loop survives', async () => {
    const logs: string[] = []
    const sender = new FakeSender()
    let boom = true
    const now = () => { if (boom) { boom = false; throw new Error('clock exploded') } return T }
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const s = startScheduler({ db, sender, now, intervalMs: 1000, log: (m) => logs.push(m) })
    await until(() => logs.length === 1)
    expect(logs[0]).toContain('clock exploded')
    await vi.advanceTimersByTimeAsync(1000)
    await until(() => sender.calls.length === 1)
    s.stop()
  })
})
