import type { Kysely } from 'kysely'
import type { Schema } from '../db/schema.js'
import { dispatchDue, type PushSender } from '../push/push.js'
import { planReminders } from './reminders.js'
import { loadSettings } from './settings.js'

export function startScheduler(deps: { db: Kysely<Schema>; sender: PushSender; now: () => Date; intervalMs?: number; log?: (msg: string) => void }): { stop(): void } {
  const log = deps.log ?? console.warn
  let running = false, stopped = false
  const tick = async () => {
    if (running || stopped) return // never overlap
    running = true
    try {
      const now = deps.now()
      const settings = await loadSettings(deps.db)
      await planReminders(deps.db, now, settings)
      await dispatchDue(deps.db, now, deps.sender, settings, log)
    } catch (e) {
      log(`scheduler tick failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      running = false
    }
  }
  void tick() // catch-up right after start
  const timer = setInterval(() => void tick(), deps.intervalMs ?? 60_000)
  return { stop() { stopped = true; clearInterval(timer) } }
}
