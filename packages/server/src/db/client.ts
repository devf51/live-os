import { Kysely, MysqlDialect } from 'kysely'
import { createPool } from 'mysql2'
import type { Schema } from './schema.js'
import * as m001 from './migrations/001_init.js'

const migrations = [{ version: '001_init', up: m001.up }]

export function createDb(url: string): Kysely<Schema> {
  return new Kysely<Schema>({
    // cast: mysql2 3.24 Pool typings don't match kysely's MysqlPool, runtime is fine
    dialect: new MysqlDialect({ pool: createPool({ uri: url, timezone: 'Z' }) as never }),
  })
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
