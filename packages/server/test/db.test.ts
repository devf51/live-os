import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql, type Kysely } from 'kysely'
import { migrate } from '../src/db/client.js'
import type { Schema } from '../src/db/schema.js'
import { testDb } from './helpers/testDb.js'

const TABLES = ['categories', 'transactions', 'budgets', 'tasks', 'events', 'habits', 'habit_logs',
  'reminders', 'push_subscriptions', 'chat_messages', 'settings']

let db: Kysely<Schema>
beforeAll(async () => { db = await testDb() })
afterAll(async () => { await db.destroy() })

describe('schema', () => {
  it('creates all 11 tables', async () => {
    const { rows } = await sql<{ n: string }>`select table_name as n from information_schema.tables where table_schema = database()`.execute(db)
    const names = rows.map((r) => r.n.toLowerCase())
    for (const t of TABLES) expect(names).toContain(t)
  })

  it('migrate is idempotent', async () => {
    await expect(migrate(db)).resolves.toBeUndefined()
  })

  it('rejects a transaction with a nonexistent category (FK)', async () => {
    await expect(db.insertInto('transactions').values({
      category_id: 999999, amount_satang: 100, kind: 'expense', occurred_at: new Date(), note: null,
      source_message_id: null, deleted_at: null,
    }).execute()).rejects.toThrow()
  })

  it('rejects duplicate habit_logs (habit_id, day) (UNIQUE)', async () => {
    const { insertId } = await db.insertInto('habits').values({ name: 'run', freq_type: 'daily', freq_value: '1', deleted_at: null }).executeTakeFirstOrThrow()
    const row = { habit_id: Number(insertId), day: '2026-11-20' }
    await db.insertInto('habit_logs').values(row).execute()
    await expect(db.insertInto('habit_logs').values(row).execute()).rejects.toThrow()
  })

  it('round-trips JSON-encoded text through actions_json and value_json', async () => {
    const obj = { a: [1, 'ก'], b: { c: null } }
    const { insertId } = await db.insertInto('chat_messages').values({ role: 'bot', text: 'x', actions_json: JSON.stringify(obj), undone_at: null }).executeTakeFirstOrThrow()
    const m = await db.selectFrom('chat_messages').select('actions_json').where('id', '=', Number(insertId)).executeTakeFirstOrThrow()
    expect(JSON.parse(m.actions_json!)).toEqual(obj)
    await db.insertInto('settings').values({ key: 'k', value_json: JSON.stringify(obj) }).execute()
    const s = await db.selectFrom('settings').select('value_json').where('key', '=', 'k').executeTakeFirstOrThrow()
    expect(JSON.parse(s.value_json)).toEqual(obj)
  })

  it('created_at default is UTC', async () => {
    const { insertId } = await db.insertInto('chat_messages').values({ role: 'user', text: 'x', actions_json: null, undone_at: null }).executeTakeFirstOrThrow()
    const r = await db.selectFrom('chat_messages').select('created_at').where('id', '=', Number(insertId)).executeTakeFirstOrThrow()
    expect(Math.abs(r.created_at.getTime() - Date.now())).toBeLessThan(5000)
  })

  it('declares exactly the six named foreign keys (MySQL ignores inline REFERENCES)', async () => {
    const { rows } = await sql<{ n: string }>`select constraint_name as n from information_schema.referential_constraints where constraint_schema = database()`.execute(db)
    expect(rows.map((r) => r.n).sort()).toEqual([
      'fk_budgets_category', 'fk_events_source_message', 'fk_habit_logs_habit',
      'fk_tasks_source_message', 'fk_transactions_category', 'fk_transactions_source_message',
    ])
  })

  it('DATE columns read back as strings, DATETIME still as UTC Date', async () => {
    await db.deleteFrom('habit_logs').execute()
    await db.deleteFrom('habits').execute()
    const { insertId } = await db.insertInto('habits').values({ name: 'x', freq_type: 'daily', freq_value: '', deleted_at: new Date('2026-11-20T17:30:00Z') }).executeTakeFirstOrThrow()
    await db.insertInto('habit_logs').values({ habit_id: Number(insertId), day: '2026-11-20' }).execute()
    const log = await db.selectFrom('habit_logs').select('day').executeTakeFirstOrThrow()
    expect(log.day).toBe('2026-11-20')
    const h = await db.selectFrom('habits').select('deleted_at').executeTakeFirstOrThrow()
    expect(h.deleted_at).toEqual(new Date('2026-11-20T17:30:00Z'))
  })
})
