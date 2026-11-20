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
})
