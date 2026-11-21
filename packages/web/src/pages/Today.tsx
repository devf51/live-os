import { useLoad, Screen } from '../useLoad'

type Item = { kind: 'event' | 'task'; id: number; title: string; at: string | null }
const time = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))

export function Today() {
  const l = useLoad<Item[]>('/today')
  return (
    <Screen title="วันนี้" loads={[l]}>
      {l.data?.length ? (
        <ul className="plain">
          {l.data.map((i) => (
            <li key={`${i.kind}-${i.id}`} className="card row">
              <span aria-hidden="true">{i.kind === 'event' ? '📅' : '✅'}</span>
              <span>{i.title}</span>
              {i.at && <time dateTime={i.at} className="muted">{time(i.at)}</time>}
            </li>
          ))}
        </ul>
      ) : (
        <p>วันนี้ไม่มีอะไร</p>
      )}
    </Screen>
  )
}
