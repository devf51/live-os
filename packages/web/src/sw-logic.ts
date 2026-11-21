export type PushPayload = { title: string; body: string; url: string }

const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d)

// Never throws: a push must always end in a visible notification.
export function parsePushPayload(data: { json(): unknown } | null | undefined): PushPayload {
  let o: Record<string, unknown> = {}
  try {
    const j = data?.json()
    if (j && typeof j === 'object') o = j as Record<string, unknown>
  } catch {
    // non-JSON payload: use defaults
  }
  return { title: str(o.title, 'live os'), body: str(o.body, ''), url: str(o.url, '/') }
}

// Same-origin path+search+hash only; anything else falls back to '/'.
export function resolveClickUrl(url: string, origin: string): string {
  try {
    const u = new URL(url, origin)
    return u.origin === origin ? u.pathname + u.search + u.hash : '/'
  } catch {
    return '/'
  }
}
