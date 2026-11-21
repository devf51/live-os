import { buildApp } from './app.js'
import { createDb, migrate } from './db/client.js'
import { seedDefaultCategories } from './ledger/ledger.js'

const { OWNER_PASSWORD_HASH, SESSION_SECRET, DATABASE_URL, PORT } = process.env
if (!OWNER_PASSWORD_HASH || !SESSION_SECRET || !DATABASE_URL) {
  console.error('Missing env: OWNER_PASSWORD_HASH, SESSION_SECRET and DATABASE_URL are required')
  process.exit(1)
}

const db = createDb(DATABASE_URL)
await migrate(db)
await seedDefaultCategories(db)

const app = buildApp({
  db,
  ownerPasswordHash: OWNER_PASSWORD_HASH,
  sessionSecret: SESSION_SECRET,
})
await app.listen({ port: Number(PORT ?? 3000), host: '0.0.0.0' })
