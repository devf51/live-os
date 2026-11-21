import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const SESSION_MS = 30 * 24 * 60 * 60 * 1000

const scryptAsync = (pw: string, salt: Buffer) =>
  new Promise<Buffer>((res, rej) => scrypt(pw, salt, 64, (e, k) => (e ? rej(e) : res(k))))

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16)
  return `${salt.toString('hex')}:${(await scryptAsync(pw, salt)).toString('hex')}`
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  const [salt, key] = hash.split(':')
  if (!salt || !key) return false
  const expected = Buffer.from(key, 'hex')
  const actual = await scryptAsync(pw, Buffer.from(salt, 'hex'))
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

const mac = (secret: string, iat: string) => createHmac('sha256', secret).update(iat).digest('hex')

export function signSession(secret: string, now: Date): string {
  const iat = String(now.getTime())
  return `${iat}.${mac(secret, iat)}`
}

export function verifySession(secret: string, token: string, now: Date): boolean {
  const [iat, sig, ...rest] = token.split('.')
  if (!iat || !sig || rest.length) return false
  const a = Buffer.from(sig)
  const b = Buffer.from(mac(secret, iat))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false
  const age = now.getTime() - Number(iat)
  return age >= 0 && age < SESSION_MS
}
