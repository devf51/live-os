import type { Kysely } from 'kysely'
import { getVapidHeaders, sendNotification as webPushSend, type PushSubscription, type RequestOptions } from 'web-push'
import type { Schema } from '../db/schema.js'
import { dueReminders, type ReminderSettings } from '../reminders/reminders.js'

type Db = Kysely<Schema>
export type PushSub = { endpoint: string; p256dh: string; auth: string }
export type PushPayload = { title: string; body: string; url: string }
export type SendOutcome = 'ok' | 'gone' | 'retry'
export interface PushSender {
  send(sub: PushSub, payload: PushPayload, opts?: { ttl?: number; urgency?: 'high' | 'normal' }): Promise<SendOutcome>
}

type SendNotification = (sub: PushSubscription, payload: string, options: RequestOptions) => Promise<unknown>
const REQUEST_TIMEOUT_MS = 10_000

export class WebPushSender implements PushSender {
  private readonly details: { subject: string; publicKey: string; privateKey: string }
  private readonly sendNotification: SendNotification
  private readonly log: (msg: string) => void
  constructor(vapid: { publicKey: string; privateKey: string; subject: string }, sendNotification: SendNotification = webPushSend, log: (msg: string) => void = console.warn) {
    try {
      getVapidHeaders('https://fcm.googleapis.com', vapid.subject, vapid.publicKey, vapid.privateKey, 'aes128gcm')
    } catch {
      // deliberately not echoing the library message or any value
      throw new Error('Invalid VAPID configuration: check VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (url-safe base64 pair from `npm run vapid`) and VAPID_SUBJECT (mailto: or https: URL)')
    }
    this.details = vapid
    this.sendNotification = sendNotification
    this.log = log
  }
  async send(sub: PushSub, payload: PushPayload, opts?: { ttl?: number; urgency?: 'high' | 'normal' }): Promise<SendOutcome> {
    try {
      await this.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), {
        TTL: opts?.ttl ?? 120, urgency: opts?.urgency ?? 'high', timeout: REQUEST_TIMEOUT_MS, vapidDetails: this.details,
      })
      return 'ok'
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      this.log(`push send failed: ${status ? `HTTP ${status}` : 'no HTTP status (network/timeout)'}`)
      return status === 404 || status === 410 ? 'gone' : 'retry'
    }
  }
}

const EVENT_TTL = 120, BUDGET_TTL = 3600

function eventBody(occursAt: Date, now: Date): string {
  const m = Math.round((occursAt.getTime() - now.getTime()) / 60_000)
  return m > 0 ? `อีก ${m} นาที` : m === 0 ? 'ถึงเวลาแล้ว' : `เริ่มไปแล้ว ${-m} นาที`
}

/** Sends every due reminder to every subscription; see Task 8 ruling V for the outcome rules. */
export async function dispatchDue(db: Db, now: Date, sender: PushSender, settings: ReminderSettings, log: (msg: string) => void = console.warn): Promise<{ sent: number; failed: number }> {
  const due = await dueReminders(db, now, settings)
  const subs = await db.selectFrom('push_subscriptions').select(['id', 'endpoint', 'p256dh', 'auth']).execute()
  let sent = 0, failed = 0
  if (due.length === 0 || subs.length === 0) return { sent, failed }
  const rows = await db.selectFrom('reminders').select(['id', 'level', 'occurs_at', 'attempts']).where('id', 'in', due.map((d) => d.id)).execute()
  const byId = new Map(rows.map((r) => [Number(r.id), r]))
  const gone = new Set<number>()
  for (const d of due) {
    const row = byId.get(d.id)
    let payload: PushPayload, opts: { ttl: number; urgency: 'high' | 'normal' }
    if (d.kind === 'event') {
      const ev = await db.selectFrom('events').select('title').where('id', '=', d.refId).where('deleted_at', 'is', null).executeTakeFirst()
      if (!ev || !row?.occurs_at) { log(`reminder ${d.id} (event): referent missing, skipped`); continue }
      payload = { title: ev.title, body: eventBody(row.occurs_at, now), url: '/' }
      opts = { ttl: EVENT_TTL, urgency: 'high' }
    } else {
      const cat = await db.selectFrom('categories').select('name').where('id', '=', d.refId).executeTakeFirst()
      if (!cat || row?.level == null) { log(`reminder ${d.id} (budget): category or level missing, skipped`); continue }
      payload = { title: 'งบประมาณ', body: `งบหมวด ${cat.name} ถึง ${row?.level}%`, url: '/' }
      opts = { ttl: BUDGET_TTL, urgency: 'normal' }
    }
    let ok = false, retry = false
    for (const s of subs) {
      if (gone.has(Number(s.id))) continue
      const out = await sender.send(s, payload, opts).catch((): SendOutcome => 'retry')
      if (out === 'ok') ok = true
      else if (out === 'retry') retry = true
      else {
        gone.add(Number(s.id))
        await db.deleteFrom('push_subscriptions').where('id', '=', s.id).execute()
      }
    }
    if (ok) {
      await db.updateTable('reminders').set({ sent_at: now }).where('id', '=', d.id).execute()
      sent++
    } else if (retry) {
      await db.updateTable('reminders').set((eb) => ({ attempts: eb('attempts', '+', 1) })).where('id', '=', d.id).execute()
      failed++
      if ((row?.attempts ?? 0) + 1 >= 3) log(`reminder ${d.id} (${d.kind}) abandoned after 3 failed attempts`)
    }
  }
  return { sent, failed }
}
