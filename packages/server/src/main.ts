import { buildApp } from './app.js'
import { createDb } from './db/client.js'

const { OWNER_PASSWORD_HASH, SESSION_SECRET, DATABASE_URL, PORT } = process.env
if (!OWNER_PASSWORD_HASH || !SESSION_SECRET || !DATABASE_URL) {
  console.error('Missing env: OWNER_PASSWORD_HASH, SESSION_SECRET and DATABASE_URL are required')
  process.exit(1)
}

const app = buildApp({
  db: createDb(DATABASE_URL),
  ownerPasswordHash: OWNER_PASSWORD_HASH,
  sessionSecret: SESSION_SECRET,
})
await app.listen({ port: Number(PORT ?? 3000), host: '0.0.0.0' })
