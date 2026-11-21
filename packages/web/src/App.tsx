import { useEffect, useState } from 'react'
import { api, UNAUTHORIZED_EVENT } from './api'
import { Login } from './pages/Login'
import { Settings } from './pages/Settings'
import { Today } from './pages/Today'
import { Money } from './pages/Money'
import { Habits } from './pages/Habits'
import { Chat } from './pages/Chat'

const TABS = [
  { id: 'chat', label: 'แชท', icon: '💬', Page: Chat },
  { id: 'today', label: 'วันนี้', icon: '🌤️', Page: Today },
  { id: 'money', label: 'เงิน', icon: '💰', Page: Money },
  { id: 'habits', label: 'นิสัย', icon: '🌱', Page: Habits },
  { id: 'settings', label: 'ตั้งค่า', icon: '⚙️', Page: null },
] as const

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [tab, setTab] = useState<string>('chat')

  useEffect(() => {
    const out = () => setAuthed(false)
    window.addEventListener(UNAUTHORIZED_EVENT, out)
    api('/auth/me').then(() => setAuthed(true), () => {})
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, out)
  }, [])

  if (authed === null) return <p className="page" role="status">กำลังโหลด…</p>
  if (!authed) return <Login onDone={() => { setTab('chat'); setAuthed(true) }} />

  const cur = TABS.find((t) => t.id === tab)!
  return (
    <>
      {cur.Page ? <cur.Page /> : <Settings onLogout={() => setAuthed(false)} />}
      <nav aria-label="เมนูหลัก">
        {TABS.map((t) => (
          <button key={t.id} aria-current={t.id === tab ? 'page' : undefined} onClick={() => setTab(t.id)}>
            <span aria-hidden="true">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </>
  )
}
