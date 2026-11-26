import { useEffect, useState } from 'react'
import { Settings as SettingsIcon } from 'lucide-react'
import { api, ApiError, UNAUTHORIZED_EVENT } from './api'
import { Login } from './pages/Login'
import { Settings } from './pages/Settings'
import { Chat } from './pages/Chat'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [offline, setOffline] = useState(false)
  const [n, setN] = useState(0)

  useEffect(() => {
    const out = () => setAuthed(false)
    window.addEventListener(UNAUTHORIZED_EVENT, out)
    setOffline(false)
    // 401 flips to login via the event; any other failure (offline, server down) must not hang on "loading"
    api('/auth/me').then(() => setAuthed(true), (e) => { if (!(e instanceof ApiError && e.status === 401)) setOffline(true) })
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, out)
  }, [n])

  if (offline) return (
    <div className="grid justify-items-start gap-3 p-6">
      <p role="alert" className="text-destructive">เชื่อมต่อไม่ได้ ลองใหม่อีกครั้งนะ</p>
      <Button onClick={() => setN((x) => x + 1)}>ลองใหม่</Button>
    </div>
  )
  if (authed === null) return <p className="p-6" role="status">กำลังโหลด…</p>
  if (!authed) return <Login onDone={() => setAuthed(true)} />

  return (
    <div className="mx-auto flex h-dvh max-w-lg flex-col">
      <header className="flex items-center justify-between px-4 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <h1 className="text-lg font-semibold">แชท</h1>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="ตั้งค่า"><SettingsIcon /></Button>
          </DialogTrigger>
          <DialogContent>
            <DialogTitle className="text-lg font-semibold">ตั้งค่า</DialogTitle>
            <Settings onLogout={() => setAuthed(false)} />
          </DialogContent>
        </Dialog>
      </header>
      <Chat />
    </div>
  )
}
