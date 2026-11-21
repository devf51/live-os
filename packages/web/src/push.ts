import { api } from './api'

export function needsIosInstall(ua: string, standalone: boolean): boolean {
  return /iPhone|iPad|iPod/.test(ua) && !standalone
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=')
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

export async function enablePush(): Promise<'ok' | 'denied' | 'unsupported'> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  if ((await Notification.requestPermission()) !== 'granted') return 'denied'
  const { key } = await api<{ key: string }>('/push/vapid-key')
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) })
  await api('/push/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON()) })
  return 'ok'
}
