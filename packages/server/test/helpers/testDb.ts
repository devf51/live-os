import type { Kysely } from 'kysely'
import { createDb, migrate } from '../../src/db/client.js'
import type { Schema } from '../../src/db/schema.js'

// Children before parents so FKs never block the drop.
const TABLES = ['settings', 'push_subscriptions', 'reminders', 'habit_logs', 'habits', 'events', 'tasks',
  'budgets', 'transactions', 'chat_messages', 'categories', 'migrations']

export async function testDb(): Promise<Kysely<Schema>> {
  const url = process.env.TEST_DATABASE_URL
  if (!url) throw new Error('TEST_DATABASE_URL is not set (e.g. mysql://root@127.0.0.1:3307/liveos_test)')
  const db = createDb(url)
  try {
    for (const t of TABLES) await db.schema.dropTable(t).ifExists().execute()
    await migrate(db)
  } catch (e) {
    await db.destroy()
    throw e
  }
  return db
}
