import { formatBaht } from '@live-os/shared/money'
import { useLoad, Screen } from '../useLoad'

type Summary = {
  incomeSatang: number
  expenseSatang: number
  byCategory: { categoryId: number; name: string; spentSatang: number; limitSatang: number | null }[]
}
type Tx = { id: number; categoryName: string; kind: 'income' | 'expense'; amountSatang: number; occurredAt: string; note: string | null }

const day = (iso: string) => new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' }).format(new Date(iso))

function Budget({ c }: { c: Summary['byCategory'][number] }) {
  const pct = c.limitSatang ? (c.spentSatang / c.limitSatang) * 100 : 0
  const level = pct >= 100 ? 'over' : pct >= 80 ? 'near' : 'ok'
  return (
    <li className="card" aria-label={c.name}>
      <div className="row"><strong>{c.name}</strong><span>{formatBaht(c.spentSatang)}{c.limitSatang ? ` / ${formatBaht(c.limitSatang)}` : ''}</span></div>
      {c.limitSatang ? (
        <>
          <div role="progressbar" aria-label={`งบ${c.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(pct))} className={`bar ${level}`}>
            <div style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          {level === 'over' && <p className="error">⚠️ เกินงบแล้ว ({Math.round(pct)}%)</p>}
          {level === 'near' && <p className="warn">⏰ ใกล้เต็มงบแล้ว ({Math.round(pct)}%)</p>}
        </>
      ) : null}
    </li>
  )
}

export function Money() {
  const s = useLoad<Summary>('/summary/month')
  const t = useLoad<Tx[]>('/transactions?limit=10')
  return (
    <Screen title="เงิน" loads={[s, t]}>
      {s.data && t.data && (
        <>
          <section className="card" aria-label="สรุปเดือนนี้">
            <p>รายรับ <strong>{formatBaht(s.data.incomeSatang)}</strong></p>
            <p>รายจ่าย <strong>{formatBaht(s.data.expenseSatang)}</strong></p>
          </section>
          {s.data.byCategory.length > 0 && (
            <>
              <h2>งบแต่ละหมวด</h2>
              <ul className="plain">{s.data.byCategory.map((c) => <Budget key={c.categoryId} c={c} />)}</ul>
            </>
          )}
          <h2>รายการล่าสุด</h2>
          {t.data.length ? (
            <ul className="plain">
              {t.data.map((x) => (
                <li key={x.id} className="card row">
                  <span>{x.categoryName}{x.note ? ` · ${x.note}` : ''} <span className="muted">{day(x.occurredAt)}</span></span>
                  <span>{x.kind === 'expense' ? '-' : '+'}{formatBaht(x.amountSatang)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>ยังไม่มีรายการ ลองบอกในแชทว่าใช้อะไรไปบ้างนะ</p>
          )}
        </>
      )}
    </Screen>
  )
}
