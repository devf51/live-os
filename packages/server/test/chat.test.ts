import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Kysely } from 'kysely'
import { testDb } from './helpers/testDb.js'
import type { Schema } from '../src/db/schema.js'
import { buildApp } from '../src/app.js'
import { testPush } from './helpers/push.js'
import { hashPassword } from '../src/auth/auth.js'
import { handleMessage, undoMessage, ChatError } from '../src/chat/chat.js'
import { FakeLlm } from '../src/llm/fake.js'
import type { LlmResult } from '../src/llm/llm.js'
import { addCategory, addTransaction, monthSummary } from '../src/ledger/ledger.js'
import { addHabit } from '../src/habits/habits.js'
import { addEvent } from '../src/planner/planner.js'
import { planReminders, DEFAULT_REMINDER_SETTINGS } from '../src/reminders/reminders.js'

let db: Kysely<Schema>
// Bangkok 2026-11-22 01:00 but UTC 2026-11-21: the two calendars differ on purpose
const NOW = new Date('2026-11-21T18:00:00Z')
const now = () => NOW
beforeAll(async () => { db = await testDb() })
afterAll(async () => { await db.destroy() })
beforeEach(async () => {
  for (const t of ['reminders', 'habit_logs', 'habits', 'events', 'tasks', 'budgets', 'transactions', 'chat_messages', 'categories'] as const) await db.deleteFrom(t).execute()
  await addCategory(db, 'อาหาร', 'expense')
  await addCategory(db, 'เงินเดือน', 'income')
})

const txn = (over: object = {}): LlmResult => ({
  kind: 'actions',
  actions: [{ type: 'add_transaction', kind: 'expense', amountSatang: 8000, category: 'อาหาร', occurredAt: '2026-11-22T01:00:00+07:00', note: 'ข้าว', ...over } as never],
})
const run = (r: LlmResult | LlmResult[], text = 'x') => handleMessage({ db, llm: new FakeLlm({ [text]: (Array.isArray(r) ? r[0]! : r) }), now }, text)
const count = async (t: 'transactions' | 'events' | 'tasks' | 'habit_logs' | 'categories') => Number((await db.selectFrom(t).select((e) => e.fn.countAll().as('n')).executeTakeFirstOrThrow()).n)
const live = async () => (await db.selectFrom('transactions').selectAll().where('deleted_at', 'is', null).execute())

describe('handleMessage: transactions', () => {
  it('records from DB values, links the user message, stores the bot message', async () => {
    const out = await run(txn({ note: 'ข้าว (model says 999 บาท)' }))
    expect(out.reply).toBe('จดแล้ว: ข้าว (model says 999 บาท) 80 บาท (อาหาร)')
    expect(out.undoable).toBe(true)
    const rows = await live()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.amount_satang).toBe(8000)
    const user = await db.selectFrom('chat_messages').selectAll().where('role', '=', 'user').executeTakeFirstOrThrow()
    expect(rows[0]!.source_message_id).toBe(user.id)
    const bot = await db.selectFrom('chat_messages').selectAll().where('id', '=', out.messageId).executeTakeFirstOrThrow()
    expect(bot.role).toBe('bot')
    expect(JSON.parse(bot.actions_json!)).toEqual([{ table: 'transactions', id: rows[0]!.id }])
  })
  it('plain reply for the example "ข้าว 80 บาท (อาหาร)"', async () => {
    expect((await run(txn())).reply).toBe('จดแล้ว: ข้าว 80 บาท (อาหาร)')
  })
  it('year 2569 is stored as 2026', async () => {
    await run(txn({ occurredAt: '2569-11-21T10:00:00+07:00' }))
    expect((await live())[0]!.occurred_at.toISOString()).toBe('2026-11-21T03:00:00.000Z')
  })
  it('ASK / chat results write nothing and show the text trimmed; empty falls back', async () => {
    expect((await run({ kind: 'ask', question: '  กี่โมงครับ ' })).reply).toBe('กี่โมงครับ')
    const c = await run({ kind: 'chat', reply: 'สวัสดีครับ' })
    expect(c).toMatchObject({ reply: 'สวัสดีครับ', undoable: false })
    expect((await run({ kind: 'chat', reply: '  ' })).reply).toMatch(/ไม่แน่ใจ/)
    expect(await count('transactions')).toBe(0)
    expect(await db.selectFrom('chat_messages').select('actions_json').where('role', '=', 'bot').execute()).toSatisfy((r: { actions_json: string | null }[]) => r.every((x) => x.actions_json === null))
  })
  it.each([
    ['amount 0', { amountSatang: 0 }], ['negative', { amountSatang: -5 }], ['fractional', { amountSatang: 1.5 }],
    ['string', { amountSatang: '8000' }], ['empty category', { category: '' }], ['no offset', { occurredAt: '2026-11-22T01:00:00' }],
  ])('schema-invalid output (%s) writes nothing and replies in Thai', async (_n, over) => {
    const out = await run(txn(over))
    expect(out.reply).toMatch(/ยังไม่ได้จดอะไร/)
    expect(out.undoable).toBe(false)
    expect(await count('transactions')).toBe(0)
  })
  it('unknown action type writes nothing', async () => {
    const out = await run({ kind: 'actions', actions: [{ type: 'drop_tables' } as never] })
    expect(out.reply).toMatch(/ยังไม่ได้จดอะไร/)
  })
  it('unknown category asks and rolls back the OTHER valid action too', async () => {
    const good = (txn() as { actions: unknown[] }).actions[0]
    const out = await run({ kind: 'actions', actions: [good, { ...(good as object), category: 'ลึกลับ' }] as never })
    expect(out.reply).toBe('ไม่มีหมวด "ลึกลับ" ครับ อยากให้สร้างหมวดใหม่ไหม (รายจ่ายหรือรายรับ)?')
    expect(await count('transactions')).toBe(0)
    expect(out.undoable).toBe(false)
  })
  it('kind/category mismatch explains and writes nothing', async () => {
    const out = await run(txn({ kind: 'income' }))
    expect(out.reply).toMatch(/ไม่ตรงกับประเภทรายรับ/)
    expect(await count('transactions')).toBe(0)
  })
  it('a failure midway rolls the first action back (second event: endsAt before startsAt)', async () => {
    const good = (txn() as { actions: unknown[] }).actions[0]
    const bad = { type: 'add_event', title: 'x', kind: 'class', startsAt: '2026-12-01T10:00:00+07:00', endsAt: '2026-12-01T09:00:00+07:00' }
    const out = await run({ kind: 'actions', actions: [good, bad] as never })
    expect(out.reply).toMatch(/ยังไม่ได้จดอะไรเลย/)
    expect(await count('transactions')).toBe(0)
    expect(await count('events')).toBe(0)
  })
})

describe('handleMessage: events, tasks, habits, categories, query', () => {
  const ev = (over: object): LlmResult => ({ kind: 'actions', actions: [{ type: 'add_event', title: 'หมอฟัน', kind: 'appointment', startsAt: '2026-11-27T15:00:00+07:00', ...over } as never] })
  it('appointment line is Bangkok formatted and the event is linked', async () => {
    const out = await run(ev({}))
    expect(out.reply).toBe('จดนัดแล้ว: หมอฟัน ศุกร์ 27 พ.ย. 15:00')
    expect(await count('events')).toBe(1)
  })
  it('past appointment asks and writes nothing; repeating class with past start is fine', async () => {
    const out = await run(ev({ startsAt: '2026-11-20T15:00:00+07:00' }))
    expect(out.reply).toMatch(/^วันที่ผ่านไปแล้ว/)
    expect(await count('events')).toBe(0)
    const c = await run(ev({ kind: 'class', title: 'แคลคูลัส', startsAt: '2026-08-03T09:00:00+07:00', repeatWeekly: true }))
    expect(c.reply).toBe('จดคลาสแล้ว: แคลคูลัส จันทร์ 3 ส.ค. 09:00 (ทุกสัปดาห์)')
  })
  it('task', async () => {
    const out = await run({ kind: 'actions', actions: [{ type: 'add_task', title: 'ส่งรายงาน', priority: 2, dueAt: '2026-11-30T17:00:00+07:00' } as never] })
    expect(out.reply).toBe('จดงานแล้ว: ส่งรายงาน กำหนด จันทร์ 30 พ.ย. 17:00')
    expect(await count('tasks')).toBe(1)
  })
  it('log_habit by name logs for the Bangkok today; undo removes it; unknown asks', async () => {
    const h = await addHabit(db, { name: 'ออกกำลังกาย', freqType: 'daily', freqValue: '' })
    const out = await run({ kind: 'actions', actions: [{ type: 'log_habit', name: '  ออกกำลังกาย ' }] })
    expect(out.reply).toBe('ติ๊กนิสัยแล้ว: ออกกำลังกาย')
    expect((await db.selectFrom('habit_logs').selectAll().execute()).map((r) => [r.habit_id, r.day])).toEqual([[h.id, '2026-11-22']])
    await undoMessage({ db }, out.messageId)
    expect(await count('habit_logs')).toBe(0)
    const unk = await run({ kind: 'actions', actions: [{ type: 'log_habit', name: 'วิ่ง' }] })
    expect(unk.reply).toMatch(/^ยังไม่มีนิสัย "วิ่ง"/)
  })
  it('log_habit already logged is not undoable and undo leaves the old log', async () => {
    await addHabit(db, { name: 'Gym', freqType: 'daily', freqValue: '' })
    const l: LlmResult = { kind: 'actions', actions: [{ type: 'log_habit', name: 'gym' }] }
    await run(l)
    const again = await run(l)
    expect(again).toMatchObject({ reply: 'ติ๊กไว้แล้ว: Gym', undoable: false })
    expect(await count('habit_logs')).toBe(1)
  })
  it('add_category creates once, is not undoable', async () => {
    const out = await run({ kind: 'actions', actions: [{ type: 'add_category', name: 'กาแฟ', kind: 'expense' }] })
    expect(out).toMatchObject({ reply: 'สร้างหมวดแล้ว: กาแฟ', undoable: false })
    await expect(undoMessage({ db }, out.messageId)).rejects.toMatchObject({ code: 'not_found' })
    expect((await run({ kind: 'actions', actions: [{ type: 'add_category', name: 'กาแฟ', kind: 'expense' }] })).reply).toMatch(/มีหมวดนี้อยู่แล้ว/)
  })
  it('query_month equals monthSummary; writes nothing; mixed with a write works', async () => {
    const food = (await db.selectFrom('categories').select('id').where('name', '=', 'อาหาร').executeTakeFirstOrThrow()).id
    await addTransaction(db, { categoryId: food, kind: 'expense', amountSatang: 12345, occurredAt: new Date('2026-11-10T05:00:00Z') })
    const out = await run({ kind: 'actions', actions: [{ type: 'query_month', month: '2026-11' }] })
    const s = await monthSummary(db, '2026-11')
    expect(s.expenseSatang).toBe(12345)
    expect(out).toMatchObject({ reply: 'เดือนนี้ใช้ไป 123.45 บาท รับ 0 บาท', undoable: false })
    const mixed = await run({ kind: 'actions', actions: [(txn() as { actions: unknown[] }).actions[0], { type: 'query_month', month: '2026-11' }] as never })
    expect(mixed.reply).toBe('จดแล้ว: ข้าว 80 บาท (อาหาร)\nเดือนนี้ใช้ไป 203.45 บาท รับ 0 บาท')
  })
})

describe('undo', () => {
  it('soft-deletes the rows, sets undone_at, summary drops it; second undo conflicts; unknown 404', async () => {
    const out = await run(txn())
    await undoMessage({ db }, out.messageId)
    expect(await live()).toHaveLength(0)
    expect((await monthSummary(db, '2026-11')).expenseSatang).toBe(0)
    expect((await db.selectFrom('chat_messages').select('undone_at').where('id', '=', out.messageId).executeTakeFirstOrThrow()).undone_at).not.toBeNull()
    await expect(undoMessage({ db }, out.messageId)).rejects.toMatchObject({ code: 'conflict' })
    await expect(undoMessage({ db }, 99999)).rejects.toBeInstanceOf(ChatError)
    await expect(undoMessage({ db }, 99999)).rejects.toMatchObject({ code: 'not_found' })
  })
  it('a user message id is not undoable; undoing leaves other rows alone', async () => {
    const keep = await addEvent(db, { title: 'keep', kind: 'class', startsAt: new Date('2026-12-01T00:00:00Z'), repeatWeekly: false })
    const out = await run(txn())
    const user = await db.selectFrom('chat_messages').select('id').where('role', '=', 'user').executeTakeFirstOrThrow()
    await expect(undoMessage({ db }, user.id)).rejects.toMatchObject({ code: 'not_found' })
    await undoMessage({ db }, out.messageId)
    expect((await db.selectFrom('events').select('deleted_at').where('id', '=', keep.id).executeTakeFirstOrThrow()).deleted_at).toBeNull()
  })
  it('undoes event + task + transaction together', async () => {
    const out = await run({ kind: 'actions', actions: [
      (txn() as { actions: unknown[] }).actions[0],
      { type: 'add_event', title: 'a', kind: 'class', startsAt: '2026-12-01T10:00:00+07:00' },
      { type: 'add_task', title: 'b', priority: 1 },
    ] as never })
    await undoMessage({ db }, out.messageId)
    for (const t of ['transactions', 'events', 'tasks'] as const) expect(await db.selectFrom(t).select('id').where('deleted_at', 'is', null).execute()).toHaveLength(0)
  })
})

describe('LLM failure, timeout, context', () => {
  it('a throwing LLM yields an apology, stores both messages, writes nothing, scheduler still works', async () => {
    const llm = new FakeLlm(() => { throw new Error('boom') })
    const out = await handleMessage({ db, llm, now }, 'hi')
    expect(out).toMatchObject({ undoable: false })
    expect(out.reply).toMatch(/ขอโทษ/)
    expect((await db.selectFrom('chat_messages').select('role').orderBy('id').execute()).map((r) => r.role)).toEqual(['user', 'bot'])
    await addEvent(db, { title: 'e', kind: 'appointment', startsAt: new Date(NOW.getTime() + 10 * 60_000), repeatWeekly: false })
    expect(await planReminders(db, NOW, DEFAULT_REMINDER_SETTINGS)).toBeGreaterThan(0)
  })
  it('a never-resolving LLM hits the injected timeout and the timer is cleared', async () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    try {
      const out = await handleMessage({ db, llm: new FakeLlm(() => new Promise(() => {})), now, timeoutMs: 30 }, 'hi')
      expect(out.reply).toMatch(/ขอโทษ/)
      expect(clear).toHaveBeenCalled()
    } finally { clear.mockRestore() }
  })
  it('passes nowIso with +07:00 and the last 10 prior messages oldest to newest, excluding the current one', async () => {
    const llm = new FakeLlm(() => ({ kind: 'chat', reply: 'ok' }))
    for (let i = 0; i < 8; i++) await handleMessage({ db, llm, now }, `m${i}`) // 16 stored messages
    const last = llm.calls.at(-1)!
    expect(last.text).toBe('m7')
    expect(last.nowIso).toBe('2026-11-22T01:00:00+07:00')
    expect(last.recent).toHaveLength(10)
    expect(last.recent.map((m) => m.role)).toEqual(['user', 'bot', 'user', 'bot', 'user', 'bot', 'user', 'bot', 'user', 'bot'])
    expect(last.recent[0]!.text).toBe('m2')
    expect(last.recent.at(-1)!.text).toBe('ok')
    expect(llm.calls[0]!.recent).toEqual([])
  })
})

describe('routes', () => {
  let app: ReturnType<typeof buildApp>
  let cookies: Record<string, string>
  let hash: string
  beforeAll(async () => { hash = await hashPassword('pw') }, 30_000)
  const setup = async (llm?: FakeLlm) => {
    app = buildApp({ db, ownerPasswordHash: hash, sessionSecret: 'test-secret-test-secret', llm, now, ...testPush })
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'pw' } })
    cookies = { [res.cookies[0]!.name]: res.cookies[0]!.value }
  }
  const call = (method: 'GET' | 'POST', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as never, cookies })

  it('401 without a session on every route', async () => {
    await setup(new FakeLlm({}))
    for (const [method, url] of [['POST', '/chat'], ['GET', '/chat/messages'], ['POST', '/chat/actions/1/undo']] as const)
      expect((await app.inject({ method, url })).statusCode).toBe(401)
    await app.close()
  })
  it('POST /chat validates the body and needs a model', async () => {
    await setup(new FakeLlm({}))
    for (const p of [{ text: '' }, { text: '   ' }, { text: 'a'.repeat(2001) }, { text: 5 }, {}]) expect((await call('POST', '/chat', p)).statusCode).toBe(400)
    await app.close()
    await setup(undefined)
    const r = await call('POST', '/chat', { text: 'hi' })
    expect(r.statusCode).toBe(503)
    expect(r.json()).toEqual({ error: 'ยังไม่ได้ตั้งค่าโมเดล' })
    expect(await db.selectFrom('chat_messages').select('id').execute()).toHaveLength(0)
    await app.close()
  })
  it('chat -> messages -> undo -> 409 / 404, exact shapes', async () => {
    await setup(new FakeLlm({ 'กินข้าว 80 บาท': txn(), 'สวัสดี': { kind: 'chat', reply: 'สวัสดีครับ' } }))
    const r = await call('POST', '/chat', { text: ' กินข้าว 80 บาท ' })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ reply: 'จดแล้ว: ข้าว 80 บาท (อาหาร)', messageId: expect.any(Number), undoable: true })
    await call('POST', '/chat', { text: 'สวัสดี' })
    const list = (await call('GET', '/chat/messages')).json()
    expect(list.map((m: { role: string; undoable: boolean }) => [m.role, m.undoable])).toEqual([['user', false], ['bot', true], ['user', false], ['bot', false]])
    expect(list[1]).toEqual({ id: r.json().messageId, role: 'bot', text: 'จดแล้ว: ข้าว 80 บาท (อาหาร)', createdAt: expect.stringMatching(/Z$/), undoable: true })
    expect((await call('GET', '/chat/messages?limit=2')).json().map((m: { text: string }) => m.text)).toEqual(['สวัสดี', 'สวัสดีครับ'])
    expect((await call('GET', '/chat/messages?limit=201')).statusCode).toBe(400)
    const u = await call('POST', `/chat/actions/${r.json().messageId}/undo`)
    expect([u.statusCode, u.json()]).toEqual([200, { ok: true }])
    expect((await call('POST', `/chat/actions/${r.json().messageId}/undo`)).statusCode).toBe(409)
    expect((await call('POST', '/chat/actions/99999/undo')).statusCode).toBe(404)
    expect((await call('GET', '/chat/messages')).json()[1].undoable).toBe(false)
    await app.close()
  })
})

describe('fix round 1: years, plausibility, logging, caps', () => {
  const ev = (over: object): LlmResult => ({ kind: 'actions', actions: [{ type: 'add_event', title: 'x', kind: 'appointment', startsAt: '2026-11-27T15:00:00+07:00', ...over } as never] })
  it('Buddhist-era query_month is normalised (no false zero)', async () => {
    const food = (await db.selectFrom('categories').select('id').where('name', '=', 'อาหาร').executeTakeFirstOrThrow()).id
    await addTransaction(db, { categoryId: food, kind: 'expense', amountSatang: 12345, occurredAt: new Date('2026-11-10T05:00:00Z') })
    expect((await run({ kind: 'actions', actions: [{ type: 'query_month', month: '2569-11' }] })).reply).toBe('เดือนนี้ใช้ไป 123.45 บาท รับ 0 บาท')
    expect((await run({ kind: 'actions', actions: [{ type: 'query_month', month: '2026-10' }] })).reply).toBe('เดือน 2026-10 ใช้ไป 0 บาท รับ 0 บาท')
  })
  it('2568-02-29 (CE 2025, no such day) is rejected, never rolled to March; 2567-02-29 is 2024-02-29', async () => {
    const out = await run(ev({ kind: 'class', repeatWeekly: true, startsAt: '2568-02-29T10:00:00+07:00' }))
    expect(out.reply).toMatch(/ยังไม่ได้จดอะไร/)
    expect(await count('events')).toBe(0)
    await run(ev({ kind: 'class', repeatWeekly: true, startsAt: '2567-02-29T10:00:00+07:00' }))
    expect((await db.selectFrom('events').select('starts_at').executeTakeFirstOrThrow()).starts_at.toISOString()).toBe('2024-02-29T03:00:00.000Z')
  })
  it.each(['9999-01-01T10:00:00+07:00', '1900-01-01T10:00:00+07:00', '2400-01-01T10:00:00+07:00', '2025-01-01T10:00:00+07:00', '2026-11-25T10:00:00+07:00'])('implausible transaction date %s asks, writes nothing', async (occurredAt) => {
    const out = await run(txn({ occurredAt }))
    expect(out.reply).toMatch(/ดูไม่ถูกต้อง/)
    expect(await count('transactions')).toBe(0)
  })
  it('shows the date when not today (Bangkok), not when today', async () => {
    expect((await run(txn({ occurredAt: '2026-11-21T10:00:00+07:00' }))).reply).toBe('จดแล้ว: ข้าว 80 บาท (อาหาร) วันที่ เสาร์ 21 พ.ย.')
    expect((await run(txn())).reply).toBe('จดแล้ว: ข้าว 80 บาท (อาหาร)')
  })
  it('event next year shows the year; years outside [y-1, y+5] ask; repeating class may be old', async () => {
    expect((await run(ev({ startsAt: '2027-01-15T10:00:00+07:00' }))).reply).toBe('จดนัดแล้ว: x ศุกร์ 15 ม.ค. 2027 10:00')
    expect((await run(ev({ startsAt: '2035-01-15T10:00:00+07:00' }))).reply).toMatch(/ดูไม่ถูกต้อง/)
    expect((await run({ kind: 'actions', actions: [{ type: 'add_task', title: 't', priority: 1, dueAt: '2040-01-01T10:00:00+07:00' } as never] })).reply).toMatch(/ดูไม่ถูกต้อง/)
    expect(await count('tasks')).toBe(0)
    expect((await run(ev({ kind: 'class', repeatWeekly: true, startsAt: '2020-01-06T09:00:00+07:00' }))).reply).toMatch(/^จดคลาสแล้ว/)
  })
  it('21 actions are rejected with no writes; 20 are fine', async () => {
    const one = (txn() as { actions: unknown[] }).actions[0]
    expect((await run({ kind: 'actions', actions: Array(21).fill(one) as never })).reply).toMatch(/ยังไม่ได้จดอะไร/)
    expect(await count('transactions')).toBe(0)
    await run({ kind: 'actions', actions: Array(20).fill(one) as never })
    expect(await count('transactions')).toBe(20)
  })
  it('a 30k-character reply is stored truncated', async () => {
    const out = await run({ kind: 'chat', reply: 'ก'.repeat(30_000) })
    expect(out.reply).toHaveLength(2000)
    expect((await db.selectFrom('chat_messages').select('text').where('id', '=', out.messageId).executeTakeFirstOrThrow()).text).toHaveLength(2000)
  })
  it('a future habit day asks instead of the generic failure', async () => {
    await addHabit(db, { name: 'Gym', freqType: 'daily', freqValue: '' })
    const out = await run({ kind: 'actions', actions: [{ type: 'log_habit', name: 'Gym', day: '2026-12-25' }] })
    expect(out.reply).toMatch(/ยังมาไม่ถึง/)
    expect(await count('habit_logs')).toBe(0)
  })
  it('existing category echoes the stored name, not the model text', async () => {
    await addCategory(db, 'Cafe', 'expense')
    expect((await run({ kind: 'actions', actions: [{ type: 'add_category', name: 'cafe', kind: 'expense' }] })).reply).toBe('มีหมวดนี้อยู่แล้ว: Cafe')
  })
  it('add_category echoes the DB name; undo stamps undone_at from deps.now', async () => {
    expect((await run({ kind: 'actions', actions: [{ type: 'add_category', name: 'กาแฟ', kind: 'expense' }] })).reply).toBe('สร้างหมวดแล้ว: กาแฟ')
    const out = await run(txn())
    await undoMessage({ db, now }, out.messageId)
    expect((await db.selectFrom('chat_messages').select('undone_at').where('id', '=', out.messageId).executeTakeFirstOrThrow()).undone_at!.toISOString()).toBe(NOW.toISOString())
  })
  describe('log hook (no user text, no payload)', () => {
    const USER = 'ลับสุดยอด-ข้อความผู้ใช้'
    const logs: { event: string; detail: Record<string, unknown> }[] = []
    const go = (llm: FakeLlm, extra: object = {}, d = db) => handleMessage({ db: d, llm, now, log: (event, detail) => logs.push({ event, detail }), ...extra }, USER)
    beforeEach(() => { logs.length = 0 })
    const noLeak = () => expect(JSON.stringify(logs)).not.toContain(USER)
    it('model throw, timeout, schema-invalid (issues path+code), DB error', async () => {
      await go(new FakeLlm(() => { throw new Error('rate limited') }))
      await go(new FakeLlm(() => new Promise(() => {})), { timeoutMs: 20 })
      await go(new FakeLlm(() => txn({ amountSatang: 0, note: USER })))
      const broken = new Proxy(db, { get: (t, k) => { const v = Reflect.get(t, k) as unknown; return k === 'transaction' ? () => { throw new Error('db down') } : typeof v === 'function' ? v.bind(t) : v } })
      await go(new FakeLlm(() => txn()), {}, broken)
      expect(logs.map((l) => l.event)).toEqual(['llm_error', 'llm_error', 'llm_schema_invalid', 'action_error'])
      expect(logs[0]!.detail).toEqual({ name: 'Error' })
      expect(logs[1]!.detail).toEqual({ name: 'LlmTimeout' })
      expect(logs[2]!.detail).toEqual({ issues: [{ path: 'actions.0.amountSatang', code: 'too_small' }] })
      expect(logs[3]!.detail).toEqual({ name: 'Error' })
      noLeak()
    })
    it('never logs driver/client messages that embed user text; keeps name/code/errno/status', async () => {
      const dup = Object.assign(new Error("Duplicate entry 'ความลับ' for key 'categories.name'"), { code: 'ER_DUP_ENTRY', errno: 1062 })
      const broken = new Proxy(db, { get: (t, k) => { const v = Reflect.get(t, k) as unknown; return k === 'transaction' ? () => { throw dup } : typeof v === 'function' ? v.bind(t) : v } })
      await go(new FakeLlm(() => txn()), {}, broken)
      await go(new FakeLlm(() => { throw Object.assign(new Error('bad request: ความลับ'), { status: 429 }) }))
      expect(logs.map((l) => l.detail)).toEqual([{ name: 'Error', code: 'ER_DUP_ENTRY', errno: 1062 }, { name: 'Error', status: 429 }])
      expect(JSON.stringify(logs)).not.toContain('ความลับ')
    })
    it('asks are not errors and are not logged', async () => {
      await go(new FakeLlm(() => txn({ category: 'ลึกลับ' })))
      expect(logs).toEqual([])
    })
  })
})
