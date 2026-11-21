import { type Kysely, sql } from 'kysely'

// level: 80|100 for budget reminders; occurs_at: UTC instant of the event occurrence (for the message and the "not started yet" check)
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('reminders').addColumn('level', sql`tinyint`).execute()
  await db.schema.alterTable('reminders').addColumn('occurs_at', 'datetime').execute()
}
