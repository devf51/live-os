import { buildApp } from './app.js'
import { createDb, migrate } from './db/client.js'
import { seedDefaultCategories } from './ledger/ledger.js'
import { WebPushSender } from './push/push.js'
import { startScheduler } from './reminders/scheduler.js'

const { OWNER_PASSWORD_HASH, SESSION_SECRET, DATABASE_URL, PORT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env
if (!OWNER_PASSWORD_HASH || !SESSION_SECRET || !DATABASE_URL || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
  console.error('Missing env: OWNER_PASSWORD_HASH, SESSION_SECRET, DATABASE_URL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are required (npm run vapid -w packages/server generates the VAPID ones)')
  process.exit(1)
}

const db = createDb(DATABASE_URL)
await migrate(db)
await seedDefaultCategories(db)

const sender = new WebPushSender({ publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY, subject: VAPID_SUBJECT })
const app = buildApp({
  db,
  sender,
  vapidPublicKey: VAPID_PUBLIC_KEY,
  ownerPasswordHash: OWNER_PASSWORD_HASH,
  sessionSecret: SESSION_SECRET,
})
await app.listen({ port: Number(PORT ?? 3000), host: '0.0.0.0' })
const scheduler = startScheduler({ db, sender, now: () => new Date() })
const shutdown = async () => {
  scheduler.stop()
  await app.close()
  await db.destroy()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
