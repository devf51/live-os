import type { Kysely } from 'kysely'
import type { Schema } from '../db/schema.js'
import { dispatchDue, type PushSender } from '../push/push.js'
import { planReminders } from './reminders.js'
import { loadSettings } from './settings.js'

export function startScheduler(deps: { db: Kysely<Schema>; sender: PushSender; now: () => Date; intervalMs?: number; log?: (msg: string) => void }): { stop(): Promise<void> } {
  const log = deps.log ?? console.warn
  let current: Promise<void> | null = null, stopped = false
  const run = async () => {
    try {
      const now = deps.now()
      const settings = await loadSettings(deps.db)
      await planReminders(deps.db, now, settings)
      await dispatchDue(deps.db, now, deps.sender, settings, log)
    } catch (e) {
      log(`scheduler tick failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const tick = () => {
    if (current || stopped) return // never overlap
    current = run().finally(() => { current = null })
  }
  tick() // catch-up right after start
  const timer = setInterval(tick, deps.intervalMs ?? 60_000)
  return { async stop() { stopped = true; clearInterval(timer); await current } } // resolves once an in-flight tick is done
}
