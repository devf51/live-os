import { buildApp } from './app.js'
import { AnthropicLlm } from './llm/anthropic.js'
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

let sender: WebPushSender
try {
  sender = new WebPushSender({ publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY, subject: VAPID_SUBJECT })
} catch (e) {
  console.error(e instanceof Error ? e.message : 'Invalid VAPID configuration')
  process.exit(1)
}
const { ANTHROPIC_API_KEY, ANTHROPIC_MODEL } = process.env
const llm = ANTHROPIC_API_KEY ? new AnthropicLlm({ apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL }) : undefined
if (!llm) console.warn('ANTHROPIC_API_KEY is not set: POST /chat will answer 503 until it is configured')
const app = buildApp({
  llm,
  log: (event, detail) => console.warn(JSON.stringify({ event, ...detail })), // already sanitised in chat.ts; Fastify's own logger stays off
  db,
  sender,
  vapidPublicKey: VAPID_PUBLIC_KEY,
  ownerPasswordHash: OWNER_PASSWORD_HASH,
  sessionSecret: SESSION_SECRET,
})
await app.listen({ port: Number(PORT ?? 3000), host: '0.0.0.0' })
const scheduler = startScheduler({ db, sender, now: () => new Date() })
let closing = false
const shutdown = async () => {
  if (closing) return
  closing = true
  try {
    await scheduler.stop() // let an in-flight tick finish its UPDATE before the pool closes
    await app.close()
    await db.destroy()
    process.exit(0)
  } catch (e) {
    console.error('shutdown failed:', e instanceof Error ? e.message : e)
    process.exit(1)
  }
}
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
