import type { Application, AppStatus } from '../types'
import { STATUS_ORDER, overdueDays } from '../types'

interface Props {
  apps: Application[]
  selectedId: string | null
  /** 已到跟进日期的记录 id */
  dueIds: Set<string>
  onOpen: (a: Application) => void
  onChangeStatus: (id: string, s: AppStatus) => void
}

/** 列表视图：一屏看全，状态可就地修改 */
export default function ListView({ apps, selectedId, dueIds, onOpen, onChangeStatus }: Props) {
  if (apps.length === 0) return <div className="empty">没有匹配的记录</div>

  return (
    <div className="list">
      <div className="list-head">
        <span>公司 / 岗位</span>
        <span>状态</span>
        <span>投递日期</span>
        <span>渠道</span>
        <span>城市</span>
        <span>薪资</span>
      </div>

      {apps.map((a) => {
        const due = dueIds.has(a.id)
        const late = due ? overdueDays(a.followUpAt) : NaN
        return (
          <div
            key={a.id}
            className={`list-row ${selectedId === a.id ? 'selected' : ''} ${due ? 'due' : ''}`}
            onClick={() => onOpen(a)}
          >
            <div className="cell-main">
              <div className="company">
                {a.company || '（未填公司）'}
                {due && (
                  <span
                    className="due-badge"
                    title={`跟进日期 ${a.followUpAt}${
                      Number.isFinite(late) && late > 0 ? `（已逾期 ${late} 天）` : '（就是今天）'
                    }`}
                  >
                    待跟进{Number.isFinite(late) && late > 0 ? ` ${late}天` : ''}
                  </span>
                )}
              </div>
              <div className="position">{a.position || '（未填岗位）'}</div>
              {a.tags.length > 0 && (
                <div className="tags">
                  {a.tags.map((t) => (
                    <span className="tag" key={t}>
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="cell-status" onClick={(e) => e.stopPropagation()}>
              <select
                className={`status-select status-${a.status}`}
                value={a.status}
                onChange={(e) => onChangeStatus(a.id, e.target.value as AppStatus)}
              >
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div className="cell-dim">{a.appliedAt || '—'}</div>
            <div className="cell-dim">{a.source || '—'}</div>
            <div className="cell-dim">{a.location || '—'}</div>
            <div className="cell-dim">{a.salary || '—'}</div>
          </div>
        )
      })}
    </div>
  )
}
