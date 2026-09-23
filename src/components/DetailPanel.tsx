import { useEffect, useState } from 'react'
import type { Application, AppStatus } from '../types'
import { STATUS_ORDER, overdueDays } from '../types'

interface Props {
  app: Application
  /** 面板宽度（px），由 App 侧的拖拽手柄控制 */
  width: number
  /** 这条是否已到跟进日期 */
  isDue: boolean
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
  onChangeStatus: (id: string, s: AppStatus) => void
  onFollowUpDone: () => void
}

function fmt(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(
    2,
    '0',
  )}`
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="d-row">
      <div className="d-label">{label}</div>
      <div className="d-value">{value}</div>
    </div>
  )
}

function ListBlock({ label, items }: { label: string; items: string[] }) {
  if (!items || items.length === 0) return null
  return (
    <div className="d-block">
      <div className="d-label">{label}</div>
      <ul className="d-ul">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  )
}

/** 右侧详情面板 */
export default function DetailPanel({
  app,
  width,
  isDue,
  onClose,
  onEdit,
  onDelete,
  onChangeStatus,
  onFollowUpDone,
}: Props) {
  const [images, setImages] = useState<string[]>([])
  const [zoom, setZoom] = useState<string | null>(null)
  /** 距计划跟进日还有几天：正数=已逾期，0=就是今天，负数=还没到 */
  const followUpLate = overdueDays(app.followUpAt)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const urls: string[] = []
      for (const p of app.jdImages) {
        const u = await window.api.readImageDataUrl(p)
        if (u) urls.push(u)
      }
      if (!cancelled) setImages(urls)
    })()
    return () => {
      cancelled = true
    }
  }, [app.jdImages])

  return (
    <>
      <aside className="detail" style={{ width }}>
        <div className="d-head">
          <div>
            <div className="d-company">{app.company || '（未填公司）'}</div>
            <div className="d-position">{app.position || '（未填岗位）'}</div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} title="关闭">
            ✕
          </button>
        </div>

        <div className="d-actions">
          <select
            className={`status-select status-${app.status}`}
            value={app.status}
            onChange={(e) => onChangeStatus(app.id, e.target.value as AppStatus)}
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button type="button" className="btn" onClick={onEdit}>
            编辑
          </button>
          <button type="button" className="btn danger" onClick={onDelete}>
            删除
          </button>
        </div>

        {/* 跟进提醒：到点了就顶在详情最上面 */}
        {app.followUpAt && (
          <div className={`followup-bar ${isDue ? 'due' : ''}`}>
            {isDue ? (
              <>
                <div className="fb-text">
                  ⏰ 该跟进了
                  <span className="fb-sub">
                    计划跟进日 {app.followUpAt}
                    {followUpLate > 0 ? ` · 已逾期 ${followUpLate} 天` : ' · 就是今天'}
                  </span>
                </div>
                <button type="button" className="btn primary" onClick={onFollowUpDone}>
                  已完成跟进
                </button>
              </>
            ) : (
              <div className="fb-text">
                📅 计划跟进日
                <span className="fb-sub">
                  {app.followUpAt}
                  {followUpLate < 0 ? ` · 还有 ${-followUpLate} 天` : ''}
                </span>
              </div>
            )}
          </div>
        )}

        {app.aiSummary && (
          <div className="d-block">
            <div className="d-label">AI 摘要</div>
            <div className="d-summary">{app.aiSummary}</div>
          </div>
        )}

        <div className="d-scroll">
          {app.tags.length > 0 && (
            <div className="d-block">
              <div className="d-label">标签</div>
              <div className="tags">
                {app.tags.map((t) => (
                  <span className="tag" key={t}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="d-grid">
            <Row label="投递日期" value={app.appliedAt} />
            <Row label="投递渠道" value={app.source} />
            <Row label="工作地点" value={app.location} />
            <Row label="薪资" value={app.salary} />
            <Row label="用工类型" value={app.employmentType} />
            <Row label="经验要求" value={app.experienceRequired} />
            <Row label="学历要求" value={app.educationRequired} />
            <Row label="联系人" value={app.contact} />
            <Row label="联系方式" value={app.contactInfo} />
            <Row label="简历版本" value={app.resumeVersion} />
          </div>

          {app.companyIntro && (
            <div className="d-block">
              <div className="d-label">公司简介</div>
              <div className="d-text">{app.companyIntro}</div>
            </div>
          )}

          <ListBlock label="岗位职责" items={app.responsibilities} />
          <ListBlock label="任职要求" items={app.requirements} />
          <ListBlock label="技能关键词" items={app.skills} />
          <ListBlock label="亮点 / 福利" items={app.highlights} />

          {app.notes && (
            <div className="d-block">
              <div className="d-label">备注</div>
              <div className="d-text">{app.notes}</div>
            </div>
          )}

          {app.coverLetter && (
            <div className="d-block">
              <div className="d-label">附言 / 求职信</div>
              <div className="d-text">{app.coverLetter}</div>
            </div>
          )}

          {images.length > 0 && (
            <div className="d-block">
              <div className="d-label">JD 截图（{images.length}）</div>
              <div className="thumbs">
                {images.map((u, i) => (
                  <img
                    key={i}
                    src={u}
                    alt={`JD 截图 ${i + 1}`}
                    onClick={() => setZoom(u)}
                    title="点击放大"
                  />
                ))}
              </div>
            </div>
          )}

          {app.jdText && (
            <div className="d-block">
              <div className="d-label">JD 原文</div>
              <pre className="jd-text">{app.jdText}</pre>
            </div>
          )}

          {app.jobUrl && (
            <div className="d-block">
              <div className="d-label">JD 链接</div>
              <a
                className="link"
                href="#"
                onClick={(e) => {
                  e.preventDefault()
                  void window.api.openPath(app.jobUrl)
                }}
              >
                {app.jobUrl}
              </a>
            </div>
          )}

          {app.statusHistory.length > 0 && (
            <div className="d-block">
              <div className="d-label">状态时间线</div>
              <div className="timeline">
                {app.statusHistory.map((h, i) => (
                  <div className="tl-item" key={i}>
                    <span className={`dot status-${h.status}`} />
                    <span className="tl-status">{h.status}</span>
                    <span className="tl-time">{fmt(h.changedAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>

      {zoom && (
        <div className="lightbox" onClick={() => setZoom(null)}>
          <img src={zoom} alt="JD 截图" />
        </div>
      )}
    </>
  )
}
