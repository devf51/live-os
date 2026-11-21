import { Kysely, MysqlDialect } from 'kysely'
import { createPool } from 'mysql2'
import type { Schema } from './schema.js'
import * as m001 from './migrations/001_init.js'

const migrations = [{ version: '001_init', up: m001.up }]

export function createDb(url: string): Kysely<Schema> {
  // dateStrings DATE: habit_logs.day stays 'YYYY-MM-DD'; DATETIME still becomes a (UTC) Date
  const pool = createPool({ uri: url, timezone: 'Z', dateStrings: ['DATE'] })
  // every pooled connection stores/defaults times in UTC (CURRENT_TIMESTAMP follows the session zone)
  pool.on('connection', (c) => c.query("SET time_zone = '+00:00'"))
  // cast: mysql2 3.24 Pool typings don't match kysely's MysqlPool, runtime is fine
  return new Kysely<Schema>({ dialect: new MysqlDialect({ pool: pool as never }) })
}

export async function migrate(db: Kysely<Schema>): Promise<void> {
  await db.schema
    .createTable('migrations')
    .ifNotExists()
    .addColumn('version', 'varchar(100)', (c) => c.primaryKey())
    .execute()
  const done = new Set((await db.selectFrom('migrations' as never).select('version' as never).execute()).map((r: any) => r.version))
  for (const mig of migrations) {
    if (done.has(mig.version)) continue
    await mig.up(db)
    await db.insertInto('migrations' as never).values({ version: mig.version } as never).execute()
  }
}
