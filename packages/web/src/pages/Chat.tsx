import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api'
import { useLoad, Screen } from '../useLoad'

type Msg = { id: number; role: 'user' | 'bot'; text: string; createdAt: string; undoable: boolean; cancelled?: boolean; pending?: boolean }

const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const fmtTime = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : clock.format(d) }
const merge = (first: string, rest: string) => (first && rest ? `${first}\n${rest}` : first || rest)
// a failed send after Chat unmounted (tab switch / logout): the next mount gets the text back
let lostDraft = ''
const EXAMPLES = ['กินข้าว 80 บาท', 'ศุกร์หน้าบ่ายสามหมอฟัน', 'วันนี้ออกกำลังกายแล้ว']
const SEND_FAIL = 'ส่งไม่สำเร็จ ลองใหม่อีกครั้งนะ'

export function Chat() {
  const l = useLoad<Msg[]>('/chat/messages?limit=50')
  const [text, setText] = useState(() => lostDraft)
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<number | null>(null)
  const tmp = useRef(0)
  const lock = useRef(false)
  const undoing = useRef(new Set<number>())
  const box = useRef<HTMLTextAreaElement>(null)
  const end = useRef<HTMLLIElement>(null)
  const mounted = useRef(false)
  const msgs = l.data
  const setMsgs = l.setData

  useEffect(() => { mounted.current = true; lostDraft = ''; return () => { mounted.current = false } }, [])
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }) }, [msgs])

  async function send() {
    const t = text.trim()
    if (!t || lock.current) return
    lock.current = true
    setSending(true)
    setErr('')
    setText('')
    const uid = --tmp.current
    const pid = --tmp.current
    const now = new Date().toISOString()
    setMsgs((p) => [...(p ?? []), { id: uid, role: 'user', text: t, createdAt: now, undoable: false }, { id: pid, role: 'bot', text: 'กำลังคิด…', createdAt: now, undoable: false, pending: true }])
    try {
      const r = await api<{ reply: string; messageId: number; undoable: boolean }>('/chat', { method: 'POST', body: JSON.stringify({ text: t }) })
      setMsgs((p) => (p ?? []).map((m) => (m.id === pid ? { id: r.messageId, role: 'bot', text: r.reply, createdAt: new Date().toISOString(), undoable: r.undoable } : m)))
    } catch (e) {
      // nothing was stored: drop both bubbles and give the text back
      setMsgs((p) => (p ?? []).filter((m) => m.id !== uid && m.id !== pid))
      if (mounted.current) setText((cur) => merge(t, cur))
      else lostDraft = merge(t, lostDraft)
      if (e instanceof ApiError && e.status === 503) {
        const note = e.body?.error ?? SEND_FAIL
        setMsgs((p) => [...(p ?? []), { id: --tmp.current, role: 'bot', text: note, createdAt: new Date().toISOString(), undoable: false }])
      } else setErr(SEND_FAIL)
    } finally {
      lock.current = false
      setSending(false)
    }
  }

  // edit = undo, then hand the previous user text back to the composer
  async function undo(m: Msg, edit: boolean) {
    if (undoing.current.has(m.id)) return
    undoing.current.add(m.id)
    const prev = edit ? (msgs ?? []).slice(0, Math.max((msgs ?? []).findIndex((x) => x.id === m.id), 0)).reverse().find((x) => x.role === 'user') : undefined
    setBusy(m.id)
    setErr('')
    let gone = false
    try {
      await api(`/chat/actions/${m.id}/undo`, { method: 'POST' })
      gone = true
    } catch (e) {
      const s = e instanceof ApiError ? e.status : 0
      if (s === 409) gone = true
      else if (s === 404) { setErr('ไม่มีอะไรให้ยกเลิกแล้วนะ'); gone = edit }
      else setErr('ยกเลิกไม่สำเร็จ ลองใหม่อีกครั้งนะ')
    } finally {
      undoing.current.delete(m.id)
      setBusy(null)
    }
    if (!gone) return
    setMsgs((p) => (p ?? []).map((x) => (x.id === m.id ? { ...x, cancelled: true } : x)))
    if (edit) {
      if (prev) { setText((cur) => merge(prev.text, cur)); box.current?.focus() }
    }
  }

  return (
    <Screen title="แชท" loads={[l]}>
      {msgs && (
        <>
          <ul className="chat-log plain" role="log" aria-live="polite" aria-label="บทสนทนา">
            {msgs.length === 0 && (
              <li className="muted">
                <p>เล่าให้ฟังได้เลย เดี๋ยวช่วยจดให้ เช่น</p>
                <ul>{EXAMPLES.map((x) => <li key={x}>{x}</li>)}</ul>
              </li>
            )}
            {msgs.map((m) => (
              <li key={m.id} className={`msg ${m.role}`}>
                <p className={m.cancelled ? 'bubble cancelled' : 'bubble'}>
                  <span className="sr-only">{m.role === 'user' ? 'คุณ' : 'ผู้ช่วย'}: </span>
                  {m.text}
                </p>
                {m.cancelled && <small>ยกเลิกแล้ว</small>}
                {m.undoable && !m.cancelled && (
                  <div className="acts">
                    <button disabled={busy === m.id} onClick={() => undo(m, false)}>ยกเลิก</button>
                    <button disabled={busy === m.id} onClick={() => undo(m, true)}>แก้</button>
                  </div>
                )}
                {!m.pending && <small>{fmtTime(m.createdAt)}</small>}
              </li>
            ))}
            <li ref={end} aria-hidden="true" />
          </ul>
          {err && <p role="alert" className="error">{err}</p>}
          <form className="composer" onSubmit={(e) => { e.preventDefault(); send() }}>
            <label className="sr-only" htmlFor="chat-input">พิมพ์เล่าให้ฟังได้เลย…</label>
            <textarea
              id="chat-input" ref={box} rows={1} maxLength={2000} placeholder="พิมพ์เล่าให้ฟังได้เลย…" value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); send() } }}
            />
            <button type="submit" disabled={sending}>ส่ง</button>
          </form>
        </>
      )}
    </Screen>
  )
}
