import { useState } from 'react'
import type { Application, AppStatus } from '../types'
import { STATUS_ORDER, overdueDays } from '../types'

interface Props {
  apps: Application[]
  /** 已到跟进日期的记录 id */
  dueIds: Set<string>
  onOpen: (a: Application) => void
  onChangeStatus: (id: string, s: AppStatus) => void
}

/** 看板视图：按状态分列，卡片可拖拽改状态 */
export default function KanbanView({ apps, dueIds, onOpen, onChangeStatus }: Props) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overStatus, setOverStatus] = useState<AppStatus | null>(null)

  return (
    <div className="kanban">
      {STATUS_ORDER.map((status) => {
        const items = apps.filter((a) => a.status === status)
        return (
          <div
            key={status}
            className={`kanban-col ${overStatus === status ? 'over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              if (overStatus !== status) setOverStatus(status)
            }}
            onDragLeave={() => setOverStatus((s) => (s === status ? null : s))}
            onDrop={(e) => {
              e.preventDefault()
              setOverStatus(null)
              if (dragId) onChangeStatus(dragId, status)
              setDragId(null)
            }}
          >
            <div className="kanban-head">
              <span className={`dot status-${status}`} />
              <span className="k-title">{status}</span>
              <span className="count">{items.length}</span>
            </div>

            <div className="kanban-body">
              {items.map((a) => {
                const due = dueIds.has(a.id)
                const late = due ? overdueDays(a.followUpAt) : NaN
                return (
                  <div
                    key={a.id}
                    className={`kanban-card ${dragId === a.id ? 'dragging' : ''} ${due ? 'due' : ''}`}
                    draggable
                    onDragStart={() => setDragId(a.id)}
                    onDragEnd={() => {
                      setDragId(null)
                      setOverStatus(null)
                    }}
                    onClick={() => onOpen(a)}
                  >
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
                    <div className="k-company">{a.company || '（未填公司）'}</div>
                    <div className="k-position">{a.position || '（未填岗位）'}</div>
                    {(a.location || a.salary) && (
                      <div className="k-meta">
                        {[a.location, a.salary].filter(Boolean).join(' · ')}
                      </div>
                    )}
                    <div className="k-foot">
                      <span>{a.appliedAt || ''}</span>
                      {a.tags.length > 0 && <span className="tag">{a.tags[0]}</span>}
                    </div>
                  </div>
                )
              })}

              {items.length === 0 && <div className="kanban-empty">拖到这里</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
