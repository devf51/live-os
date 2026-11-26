import type { PushSender, PushSub, PushPayload, SendOutcome } from '../../src/push/push.js'

export class FakeSender implements PushSender {
  calls: { sub: PushSub; payload: PushPayload; ttl?: number; urgency?: string }[] = []
  /** outcome per endpoint (default 'ok') */
  outcomes: Record<string, SendOutcome> = {}
  async send(sub: PushSub, payload: PushPayload, opts?: { ttl?: number; urgency?: 'high' | 'normal' }): Promise<SendOutcome> {
    this.calls.push({ sub, payload, ttl: opts?.ttl, urgency: opts?.urgency })
    return this.outcomes[sub.endpoint] ?? 'ok'
  }
}
/** Deps for buildApp in tests that don't care about push. */
export const testPush = { sender: new FakeSender(), vapidPublicKey: 'test-public-key' }
