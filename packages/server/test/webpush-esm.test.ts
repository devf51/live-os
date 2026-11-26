import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Vitest's transform hides ESM/CJS interop errors, so load push.ts under real Node ESM.
describe('web-push under real Node ESM', () => {
  it('push.ts loads and WebPushSender accepts freshly generated VAPID keys', () => {
    const push = fileURLToPath(new URL('../src/push/push.ts', import.meta.url))
    const script = `
      import { generateVAPIDKeys } from 'web-push'
      const { WebPushSender } = await import(${JSON.stringify(push)})
      const k = generateVAPIDKeys()
      const s = new WebPushSender({ publicKey: k.publicKey, privateKey: k.privateKey, subject: 'mailto:a@b.co' })
      if (typeof s.send !== 'function') throw new Error('no send')
      console.log('ok')`
    const out = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' })
    expect(out.trim()).toBe('ok')
  }, 30_000)
})
