import { useState } from 'react'
import { api } from '../api'
import { enablePush, needsIosInstall } from '../push'
import { InstallGuide } from './InstallGuide'

const MSG = {
  ok: 'เปิดการแจ้งเตือนแล้ว',
  denied: 'ยังไม่ได้รับอนุญาต เปิดสิทธิ์แจ้งเตือนได้ในการตั้งค่าของเบราว์เซอร์',
  unsupported: 'อุปกรณ์นี้ยังไม่รองรับการแจ้งเตือน',
} as const

export function Settings({ onLogout }: { onLogout: () => void }) {
  const [msg, setMsg] = useState('')
  const ios = needsIosInstall(navigator.userAgent, matchMedia('(display-mode: standalone)').matches)

  async function enable() {
    try {
      setMsg(MSG[await enablePush()])
    } catch {
      setMsg('ขออภัย เปิดไม่สำเร็จ ลองใหม่อีกครั้ง')
    }
  }

  return (
    <main className="page">
      <h1>ตั้งค่า</h1>
      {ios && <InstallGuide />}
      <button onClick={enable}>เปิดการแจ้งเตือน</button>
      <p role="status">{msg}</p>
      <button className="quiet" onClick={() => api('/auth/logout', { method: 'POST' }).finally(onLogout)}>ออกจากระบบ</button>
    </main>
  )
}
