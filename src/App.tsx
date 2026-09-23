import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Application, AppStatus, ParsedJD, Settings } from './types'
import { STATUS_ORDER, TERMINAL_STATUSES, isDue, todayStr } from './types'
import ListView from './views/ListView'
import KanbanView from './views/KanbanView'
import DetailPanel from './components/DetailPanel'
import ApplicationForm from './components/ApplicationForm'
import SettingsDialog from './components/SettingsDialog'
import Resizer, { usePanelWidth } from './components/Resizer'

type EditingState = Application | 'new' | null

/** 左侧筛选栏 / 右侧详情栏的宽度约束（双击手柄恢复 default） */
const FILTERS_WIDTH = { min: 150, max: 380, default: 190 }
const DETAIL_WIDTH = { min: 300, max: 760, default: 420 }
/** 中间内容区必须保留的最小宽度：窗口不够宽时优先压缩两侧面板 */
const CONTENT_MIN = 360
/** 两条拖拽手柄占用的总宽度，必须与 styles.css 里 .resizer 的 width 一致 */
const RESIZER_TOTAL = 12

/** ArrayBuffer → base64（分块处理，避免超长字符串爆栈） */
function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** AI 解析结果 → 新建表单的初始值 */
function parsedToDraft(d: ParsedJD, imagePath: string): Partial<Application> {
  return {
    company: d.company ?? '',
    position: d.position ?? '',
    location: d.location ?? '',
    salary: d.salary ?? '',
    employmentType: d.employmentType ?? '',
    experienceRequired: d.experienceRequired ?? '',
    educationRequired: d.educationRequired ?? '',
    companyIntro: d.companyIntro ?? '',
    responsibilities: d.responsibilities,
    requirements: d.requirements,
    skills: d.skills,
    highlights: d.highlights,
    jdImages: [imagePath],
    appliedAt: new Date().toISOString().slice(0, 10),
  }
}

export default function App() {
  const [apps, setApps] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'list' | 'kanban'>('list')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [sourceFilter, setSourceFilter] = useState<string>('')
  /** 只看「该跟进了」的记录 */
  const [onlyDue, setOnlyDue] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<EditingState>(null)
  /** 粘贴截图后 AI 解析出的预填值（配合 editing==='new' 使用） */
  const [prefill, setPrefill] = useState<Partial<Application> | null>(null)
  /** 非空时显示"正在解析"浮层 */
  const [pasteBusy, setPasteBusy] = useState('')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState(false)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(''), 3200)
  }, [])

  const refresh = useCallback(async () => {
    const list = await window.api.list()
    setApps(list)
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
    void window.api.getSettings().then(setSettings)
  }, [refresh])

  /**
   * 支持在任意位置（含搜索框）Ctrl+V 粘贴截图：
   * 图片落盘 → 交给本地模型解析 → 打开新建表单并预填。
   * 弹窗打开时不接管事件，避免与表单内的操作打架。
   */
  useEffect(() => {
    if (editing !== null || settingsOpen) return

    async function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items
      if (!items || items.length === 0) return

      const imageItem = Array.from(items).find((it) => it.type.startsWith('image/'))
      // 不是图片就放行，保留正常的文本粘贴行为
      if (!imageItem) return
      e.preventDefault()

      const file = imageItem.getAsFile()
      if (!file) return

      setPasteBusy('正在保存截图…')
      try {
        const b64 = bufToBase64(await file.arrayBuffer())
        const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')
        const savedPath = await window.api.savePastedImage(b64, ext)

        setPasteBusy('正在用 AI 解析截图…（本地推理约 30–60 秒）')
        const res = await window.api.parseJD({ imagePaths: [savedPath] })

        setPasteBusy('')
        if (!res.ok || !res.data) {
          showToast(`图片解析失败：${res.error ?? '未知错误'}。可点「+ 新建记录」手动填写。`)
          return
        }
        setPrefill(parsedToDraft(res.data, savedPath))
        setEditing('new')
        showToast('截图解析完成，请核对后保存')
      } catch (err: any) {
        setPasteBusy('')
        showToast(`处理粘贴的图片失败：${err?.message ?? err}`)
      }
    }

    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [editing, settingsOpen, showToast])

  /** 全部渠道（用于筛选下拉） */
  const sources = useMemo(() => {
    const set = new Set<string>()
    for (const a of apps) if (a.source) set.add(a.source)
    return [...set].sort()
  }, [apps])

  /** 按状态计数 */
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of apps) map.set(a.status, (map.get(a.status) ?? 0) + 1)
    return map
  }, [apps])

  /**
   * 该跟进了的记录。
   * 到期判断用本地日期，并排除不提醒的阶段（终态即使残留了跟进日期也不算）。
   */
  const dueIds = useMemo(() => {
    const today = todayStr()
    const set = new Set<string>()
    for (const a of apps) if (isDue(a, settings?.followUpDays, today)) set.add(a.id)
    return set
  }, [apps, settings])

  /** 筛选后的列表 */
  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase()
    return apps.filter((a) => {
      if (onlyDue && !dueIds.has(a.id)) return false
      if (statusFilter && a.status !== statusFilter) return false
      if (sourceFilter && a.source !== sourceFilter) return false
      if (!kw) return true
      const hay = [
        a.company,
        a.position,
        a.location,
        a.salary,
        a.jdText,
        a.notes,
        a.tags.join(' '),
        a.skills.join(' '),
        a.contact,
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(kw)
    })
  }, [apps, search, statusFilter, sourceFilter, onlyDue, dueIds])

  const selected = useMemo(
    () => (selectedId ? (apps.find((a) => a.id === selectedId) ?? null) : null),
    [apps, selectedId],
  )

  // ---------- 左右面板宽度（可拖拽调节） ----------
  /** 窗口宽度：用来限制两侧面板，避免把中间内容区挤没 */
  const [winWidth, setWinWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = () => setWinWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const filtersPanel = usePanelWidth('jt.filtersWidth', FILTERS_WIDTH)
  const detailPanel = usePanelWidth('jt.detailWidth', DETAIL_WIDTH)

  const detailOpen = selected !== null
  /** 内容区下限 + 手柄之外，可以直接分配给两侧面板的总宽度 */
  const panelBudget = winWidth - CONTENT_MIN - (detailOpen ? RESIZER_TOTAL : RESIZER_TOTAL / 2)

  /**
   * 详情栏优先，左侧栏拿剩下的额度；两者都不低于各自下限。
   * 这些是**派生值**：窗口变窄时面板跟着收，但不会覆盖用户拖出来的宽度，
   * 窗口放大回去后仍然是他原来设定的尺寸。
   */
  const detailWidth = detailOpen
    ? Math.max(DETAIL_WIDTH.min, Math.min(detailPanel.width, panelBudget - FILTERS_WIDTH.min))
    : 0
  const filtersWidth = Math.max(
    FILTERS_WIDTH.min,
    Math.min(filtersPanel.width, panelBudget - detailWidth),
  )
  /** 传给手柄的实际上限（供 aria 与拖拽上限使用） */
  const filtersMax = Math.max(
    FILTERS_WIDTH.min,
    Math.min(FILTERS_WIDTH.max, panelBudget - detailWidth),
  )
  const detailMax = Math.max(
    DETAIL_WIDTH.min,
    Math.min(DETAIL_WIDTH.max, panelBudget - filtersWidth),
  )

  const handleSave = useCallback(
    async (data: Partial<Application>) => {
      setBusy(true)
      try {
        if (editing && editing !== 'new') {
          await window.api.update(editing.id, data)
          showToast('已保存')
        } else {
          const created = await window.api.create(data as any)
          setSelectedId(created.id)
          showToast('已新增记录')
        }
        setEditing(null)
        setPrefill(null)
        await refresh()
      } catch (err: any) {
        showToast(`保存失败：${err?.message ?? err}`)
      } finally {
        setBusy(false)
      }
    },
    [editing, refresh, showToast],
  )

  const handleChangeStatus = useCallback(
    async (id: string, status: AppStatus) => {
      try {
        await window.api.update(id, { status })
        await refresh()
      } catch (err: any) {
        showToast(`改状态失败：${err?.message ?? err}`)
      }
    },
    [refresh, showToast],
  )

  /** 标记已完成跟进：主进程按当前阶段间隔把日期顺延一个周期 */
  const handleFollowUpDone = useCallback(
    async (id: string) => {
      try {
        const next = await window.api.followUpDone(id)
        await refresh()
        showToast(next.followUpAt ? `已跟进，下次提醒 ${next.followUpAt}` : '已跟进')
      } catch (err: any) {
        showToast(`操作失败：${err?.message ?? err}`)
      }
    },
    [refresh, showToast],
  )

  const handleDelete = useCallback(    async (id: string) => {
      if (!window.confirm('确定删除这条投递记录吗？该操作不可撤销。')) return
      try {
        await window.api.remove(id)
        if (selectedId === id) setSelectedId(null)
        setEditing(null)
        await refresh()
        showToast('已删除')
      } catch (err: any) {
        showToast(`删除失败：${err?.message ?? err}`)
      }
    },
    [refresh, selectedId, showToast],
  )

  const handleExport = useCallback(async () => {
    try {
      const p = await window.api.exportData()
      if (p) showToast(`已导出到 ${p}`)
    } catch (err: any) {
      showToast(`导出失败：${err?.message ?? err}`)
    }
  }, [showToast])

  const handleImport = useCallback(
    async (mode: 'merge' | 'replace') => {
      try {
        const n = await window.api.importData(mode)
        if (n !== null) {
          await refresh()
          showToast(`导入完成，现有 ${n} 条记录`)
        }
      } catch (err: any) {
        showToast(`导入失败：${err?.message ?? err}`)
      }
    },
    [refresh, showToast],
  )

  const activeCount = apps.filter((a) => !TERMINAL_STATUSES.includes(a.status)).length

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          求职投递记录
          <span className="brand-sub">共 {apps.length} 条 · 进行中 {activeCount} 条</span>
        </div>

        <input
          className="search"
          placeholder="搜索公司 / 岗位 / 技能 / 备注…　也可以直接 Ctrl+V 粘贴 JD 截图"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="seg">
          <button
            type="button"
            className={view === 'list' ? 'active' : ''}
            onClick={() => setView('list')}
          >
            列表
          </button>
          <button
            type="button"
            className={view === 'kanban' ? 'active' : ''}
            onClick={() => setView('kanban')}
          >
            看板
          </button>
        </div>

        <div className="toolbar-right">
          <button type="button" className="btn primary" onClick={() => setEditing('new')}>
            + 新建记录
          </button>
          <button type="button" className="btn" onClick={handleExport}>
            导出
          </button>
          <button type="button" className="btn" onClick={() => handleImport('merge')}>
            导入
          </button>
          <button type="button" className="btn" onClick={() => setSettingsOpen(true)}>
            设置
          </button>
        </div>
      </header>

      <div className="body">
        <aside className="filters" style={{ width: filtersWidth }}>
          <div className="filter-head">筛选</div>

          {/* 到期提醒：放在最上面，打开应用第一眼就能看到 */}
          {dueIds.size > 0 && (
            <button
              type="button"
              className={`filter-item due ${onlyDue ? 'active' : ''}`}
              onClick={() => setOnlyDue((v) => !v)}
              title="跟进日期已到，建议主动问一下进度"
            >
              <span>⏰ 该跟进了</span>
              <span className="count">{dueIds.size}</span>
            </button>
          )}

          <button
            type="button"
            className={`filter-item ${statusFilter === '' && !onlyDue ? 'active' : ''}`}
            onClick={() => {
              setStatusFilter('')
              setOnlyDue(false)
            }}
          >
            <span>全部状态</span>
            <span className="count">{apps.length}</span>
          </button>

          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              className={`filter-item ${statusFilter === s ? 'active' : ''}`}
              onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
            >
              <span className={`dot status-${s}`} />
              <span>{s}</span>
              <span className="count">{counts.get(s) ?? 0}</span>
            </button>
          ))}

          {sources.length > 0 && (
            <>
              <div className="filter-head" style={{ marginTop: 18 }}>
                投递渠道
              </div>
              {sources.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`filter-item ${sourceFilter === s ? 'active' : ''}`}
                  onClick={() => setSourceFilter(sourceFilter === s ? '' : s)}
                >
                  <span>{s}</span>
                  <span className="count">
                    {apps.filter((a) => a.source === s).length}
                  </span>
                </button>
              ))}
            </>
          )}
        </aside>

        <Resizer
          label="调整左侧筛选栏宽度"
          side="right"
          width={filtersWidth}
          min={FILTERS_WIDTH.min}
          max={filtersMax}
          onDrag={filtersPanel.setWidth}
          onReset={filtersPanel.reset}
        />

        <main className="content">
          {loading ? (
            <div className="empty">加载中…</div>
          ) : apps.length === 0 ? (
            <div className="empty">
              <p>还没有投递记录</p>
              <button type="button" className="btn primary" onClick={() => setEditing('new')}>
                新建第一条
              </button>
            </div>
          ) : view === 'list' ? (
            <ListView
              apps={filtered}
              selectedId={selectedId}
              dueIds={dueIds}
              onOpen={(a) => setSelectedId(a.id)}
              onChangeStatus={handleChangeStatus}
            />
          ) : (
            <KanbanView
              apps={filtered}
              dueIds={dueIds}
              onOpen={(a) => setSelectedId(a.id)}
              onChangeStatus={handleChangeStatus}
            />
          )}
        </main>

        {/* 详情栏放在 .body 内部，才会和左栏/列表并排成三列（原先在 .body 外，
            被 .app 的 column 布局挤到了底部） */}
        {selected && (
          <>
            <Resizer
              label="调整右侧详情栏宽度"
              side="left"
              width={detailWidth}
              min={DETAIL_WIDTH.min}
              max={detailMax}
              onDrag={detailPanel.setWidth}
              onReset={detailPanel.reset}
            />
            <DetailPanel
              app={selected}
              width={detailWidth}
              isDue={dueIds.has(selected.id)}
              onClose={() => setSelectedId(null)}
              onEdit={() => setEditing(selected)}
              onDelete={() => handleDelete(selected.id)}
              onChangeStatus={handleChangeStatus}
              onFollowUpDone={() => handleFollowUpDone(selected.id)}
            />
          </>
        )}
      </div>

      {editing && (
        <ApplicationForm
          initial={editing === 'new' ? prefill : editing}
          isEdit={editing !== 'new'}
          settings={settings}
          busy={busy}
          onSave={handleSave}
          onCancel={() => {
            setEditing(null)
            setPrefill(null)
          }}
          showToast={showToast}
        />
      )}

      {pasteBusy && (
        <div className="busy-float">
          <span className="spinner" />
          <span>{pasteBusy}</span>
        </div>
      )}

      {settingsOpen && settings && (
        <SettingsDialog
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSaved={(s) => {
            setSettings(s)
            showToast('设置已保存')
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
