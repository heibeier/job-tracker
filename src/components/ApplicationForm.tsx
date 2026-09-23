import { useEffect, useMemo, useState } from 'react'
import type { Application, AppStatus, Settings } from '../types'
import {
  SOURCE_CHANNELS,
  STATUS_ORDER,
  addDays,
  followUpDaysMap,
  isFollowUpDue,
  isoToLocalDate,
  todayStr,
} from '../types'

interface Props {
  /** 初始值。新建时可只给部分字段（例如粘贴图片后 AI 预填的结果） */
  initial: Partial<Application> | null
  /** true = 编辑已有记录；false = 新建（含粘贴截图后自动预填的场景） */
  isEdit: boolean
  settings: Settings | null
  busy: boolean
  onSave: (data: Partial<Application>) => void
  onCancel: () => void
  showToast: (msg: string) => void
}

/** 每行一条，转成数组 */
const toLines = (arr: string[]) => arr.join('\n')
const fromLines = (text: string) =>
  text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

const today = () => todayStr()

/** 投递日期的快捷选择：多数情况就是这三天，省得去点日期控件 */
const DATE_QUICKS = [
  { label: '今天', offset: 0 },
  { label: '昨天', offset: -1 },
  { label: '前天', offset: -2 },
]

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function weekdayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`)
  return Number.isNaN(d.getTime()) ? '' : `周${WEEKDAYS[d.getDay()]}`
}

export default function ApplicationForm({
  initial,
  isEdit,
  settings,
  busy,
  onSave,
  onCancel,
  showToast,
}: Props) {
  const [company, setCompany] = useState(initial?.company ?? '')
  const [position, setPosition] = useState(initial?.position ?? '')
  const [status, setStatus] = useState<AppStatus>(initial?.status ?? '已投递')
  const [appliedAt, setAppliedAt] = useState(initial?.appliedAt || today())
  const [source, setSource] = useState(initial?.source ?? '')
  const [location, setLocation] = useState(initial?.location ?? '')
  const [salary, setSalary] = useState(initial?.salary ?? '')
  const [employmentType, setEmploymentType] = useState(initial?.employmentType ?? '')
  const [experienceRequired, setExperienceRequired] = useState(initial?.experienceRequired ?? '')
  const [educationRequired, setEducationRequired] = useState(initial?.educationRequired ?? '')
  const [companyIntro, setCompanyIntro] = useState(initial?.companyIntro ?? '')

  const [jdText, setJdText] = useState(initial?.jdText ?? '')
  const [jdImages, setJdImages] = useState<string[]>(initial?.jdImages ?? [])
  const [thumbs, setThumbs] = useState<string[]>([])

  const [responsibilities, setResponsibilities] = useState(toLines(initial?.responsibilities ?? []))
  const [requirements, setRequirements] = useState(toLines(initial?.requirements ?? []))
  const [skills, setSkills] = useState(toLines(initial?.skills ?? []))
  const [highlights, setHighlights] = useState(toLines(initial?.highlights ?? []))

  const [contact, setContact] = useState(initial?.contact ?? '')
  const [contactInfo, setContactInfo] = useState(initial?.contactInfo ?? '')
  const [resumeVersion, setResumeVersion] = useState(initial?.resumeVersion ?? '')
  const [followUpAt, setFollowUpAt] = useState(initial?.followUpAt ?? '')
  const [jobUrl, setJobUrl] = useState(initial?.jobUrl ?? '')
  const [tagsText, setTagsText] = useState((initial?.tags ?? []).join(', '))
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [coverLetter, setCoverLetter] = useState(initial?.coverLetter ?? '')

  const [parsing, setParsing] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiInfo, setAiInfo] = useState('')
  const [showAi, setShowAi] = useState(true)
  /** 用户是否亲手改过跟进日期 —— 只有改过才把它提交给主进程，否则让主进程按阶段自动算 */
  const [followUpEdited, setFollowUpEdited] = useState(false)

  /**
   * 实时预览「这条会在哪天提醒我」。
   * 计时起点要和主进程保持一致：改过状态就从今天算，否则从最后一次状态变更算，
   * 全新/从未改过状态的记录则从投递日期算。
   */
  const followUpPreview = useMemo(() => {
    const interval = followUpDaysMap(settings?.followUpDays)[status] ?? 0
    if (interval <= 0) return { interval, date: '', due: false }

    const history = initial?.statusHistory ?? []
    const changedInForm = isEdit && status !== initial?.status
    const start = changedInForm
      ? todayStr()
      : isEdit && history.length > 1
        ? isoToLocalDate(history[history.length - 1].changedAt) || todayStr()
        : appliedAt || todayStr()

    const date = addDays(start, interval)
    return { interval, date, due: isFollowUpDue(date) }
  }, [status, appliedAt, settings, isEdit, initial])

  // 已有截图的缩略图
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const urls: string[] = []
      for (const p of jdImages) {
        const u = await window.api.readImageDataUrl(p)
        if (u) urls.push(u)
      }
      if (!cancelled) setThumbs(urls)
    })()
    return () => {
      cancelled = true
    }
  }, [jdImages])

  async function pickImages() {
    const picked = await window.api.pickImages()
    if (picked.length > 0) setJdImages((prev) => [...prev, ...picked])
  }

  function removeImage(idx: number) {
    setJdImages((prev) => prev.filter((_, i) => i !== idx))
  }

  /** 调用本地模型解析 JD，并把结果填进表单 */
  async function handleParse() {
    setAiError('')
    setAiInfo('')
    if (!jdText.trim() && jdImages.length === 0) {
      setAiError('请先粘贴 JD 文本，或添加至少一张 JD 截图。')
      return
    }
    setParsing(true)
    try {
      const res = await window.api.parseJD({ text: jdText, imagePaths: jdImages })
      if (!res.ok || !res.data) {
        setAiError(res.error || '解析失败')
        return
      }
      const d = res.data
      if (d.company) setCompany((v) => v || d.company!)
      if (d.position) setPosition((v) => v || d.position!)
      if (d.location) setLocation(d.location)
      if (d.salary) setSalary(d.salary)
      if (d.employmentType) setEmploymentType(d.employmentType)
      if (d.experienceRequired) setExperienceRequired(d.experienceRequired)
      if (d.educationRequired) setEducationRequired(d.educationRequired)
      if (d.companyIntro) setCompanyIntro(d.companyIntro)
      if (d.responsibilities.length) setResponsibilities(toLines(d.responsibilities))
      if (d.requirements.length) setRequirements(toLines(d.requirements))
      if (d.skills.length) setSkills(d.skills.join('\n'))
      if (d.highlights.length) setHighlights(toLines(d.highlights))

      const warn =
        d.unreadable.length > 0 ? `；有 ${d.unreadable.length} 个字段无法辨认，请人工核对` : ''
      setAiInfo(`解析完成（置信度：${d.confidence}${warn}）`)
      showToast('AI 解析完成，请核对后保存')
    } catch (err: any) {
      setAiError(String(err?.message ?? err))
    } finally {
      setParsing(false)
    }
  }

  function handleSubmit() {
    if (!company.trim() || !position.trim()) {
      showToast('公司和岗位是必填项')
      return
    }
    onSave({
      company: company.trim(),
      position: position.trim(),
      status,
      appliedAt,
      source,
      location,
      salary,
      employmentType,
      experienceRequired,
      educationRequired,
      companyIntro,
      jdText,
      jdImages,
      responsibilities: fromLines(responsibilities),
      requirements: fromLines(requirements),
      skills: fromLines(skills),
      highlights: fromLines(highlights),
      contact,
      contactInfo,
      resumeVersion,
      // 只有用户亲手改过跟进日期才提交；否则交给主进程按阶段自动算，
      // 这样改状态时它会跟着重算，而不是被这里带过去的旧值钉死
      ...(followUpEdited ? { followUpAt } : {}),
      jobUrl,
      tags: tagsText
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
      notes,
      coverLetter,
    })
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{isEdit ? '编辑投递记录' : '新建投递记录'}</h2>
          <button type="button" className="icon-btn" onClick={onCancel}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          {/* ---------- 投递日期：建档时第一件要确认的事 ---------- */}
          <section className="form-section date-first">
            <div className="section-title">
              真实投递日期
              <span className="hint-inline">这条是什么时候投出去的？跟进提醒从这天开始算</span>
            </div>

            <div className="date-row">
              <div className="date-quick">
                {DATE_QUICKS.map((q) => {
                  const value = addDays(todayStr(), q.offset)
                  return (
                    <button
                      key={q.label}
                      type="button"
                      className={`date-chip ${appliedAt === value ? 'active' : ''}`}
                      onClick={() => setAppliedAt(value)}
                    >
                      {q.label}
                    </button>
                  )
                })}
              </div>
              <input
                type="date"
                className="date-input"
                value={appliedAt}
                onChange={(e) => setAppliedAt(e.target.value)}
              />
              <span className="date-weekday">{appliedAt ? weekdayOf(appliedAt) : ''}</span>
            </div>

            {followUpPreview.interval > 0 ? (
              <div className={`followup-preview ${followUpPreview.due ? 'due' : ''}`}>
                {followUpPreview.due ? '⏰ ' : '📅 '}
                按「{status}」阶段 {followUpPreview.interval} 天算，将在{' '}
                <strong>{followUpPreview.date}</strong> 提醒你跟进
                {followUpPreview.due && <span className="due-tag">已到期</span>}
              </div>
            ) : (
              <div className="followup-preview muted">
                「{status}」阶段不设跟进提醒（可在设置里改）
              </div>
            )}
          </section>

          {/* ---------- 基本信息 ---------- */}
          <section className="form-section">
            <div className="section-title">基本信息</div>
            <div className="grid-3">
              <label className="field">
                <span>公司 *</span>
                <input value={company} onChange={(e) => setCompany(e.target.value)} />
              </label>
              <label className="field">
                <span>岗位 *</span>
                <input value={position} onChange={(e) => setPosition(e.target.value)} />
              </label>
              <label className="field">
                <span>状态</span>
                <select value={status} onChange={(e) => setStatus(e.target.value as AppStatus)}>
                  {STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>投递渠道</span>
                <input
                  list="source-options"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="如 BOSS直聘"
                />
                <datalist id="source-options">
                  {SOURCE_CHANNELS.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </label>
              <label className="field">
                <span>工作地点</span>
                <input value={location} onChange={(e) => setLocation(e.target.value)} />
              </label>
              <label className="field">
                <span>薪资</span>
                <input
                  value={salary}
                  onChange={(e) => setSalary(e.target.value)}
                  placeholder="如 15-25K·14薪"
                />
              </label>
              <label className="field">
                <span>用工类型</span>
                <input
                  value={employmentType}
                  onChange={(e) => setEmploymentType(e.target.value)}
                  placeholder="全职 / 实习 / 外包"
                />
              </label>
              <label className="field">
                <span>经验要求</span>
                <input
                  value={experienceRequired}
                  onChange={(e) => setExperienceRequired(e.target.value)}
                />
              </label>
              <label className="field">
                <span>学历要求</span>
                <input
                  value={educationRequired}
                  onChange={(e) => setEducationRequired(e.target.value)}
                />
              </label>
              <label className="field">
                <span>简历版本</span>
                <input value={resumeVersion} onChange={(e) => setResumeVersion(e.target.value)} />
              </label>
              <label className="field">
                <span>跟进日期</span>
                <input
                  type="date"
                  value={followUpAt}
                  onChange={(e) => {
                    setFollowUpAt(e.target.value)
                    setFollowUpEdited(true)
                  }}
                />
                <small className="hint">
                  {followUpEdited ? '已手动指定，改状态前都按这个日期提醒' : '留空则按阶段自动计算'}
                </small>
              </label>
            </div>
            <label className="field">
              <span>标签（逗号分隔）</span>
              <input
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                placeholder="大厂, 外企, 远程, 急招"
              />
            </label>
          </section>

          {/* ---------- JD 与 AI 解析 ---------- */}
          <section className="form-section">
            <div className="section-title">
              JD 内容
              <span className="hint-inline">
                粘贴文本或添加截图，然后点「AI 解析」自动填表
              </span>
            </div>

            <label className="field">
              <span>JD 文本</span>
              <textarea
                rows={6}
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                placeholder="把招聘页面的 JD 文字粘贴到这里…"
              />
            </label>

            <div className="field">
              <span>JD 截图</span>
              <div className="img-row">
                {thumbs.map((u, i) => (
                  <div className="img-thumb" key={i}>
                    <img src={u} alt={`截图 ${i + 1}`} />
                    <button type="button" onClick={() => removeImage(i)} title="移除">
                      ✕
                    </button>
                  </div>
                ))}
                <button type="button" className="img-add" onClick={pickImages}>
                  + 添加截图
                </button>
              </div>
            </div>

            <div className="ai-bar">
              <button
                type="button"
                className="btn primary"
                onClick={handleParse}
                disabled={parsing}
              >
                {parsing ? '解析中…（本地推理较慢）' : '✨ AI 解析'}
              </button>
              <span className="ai-model">
                模型：{settings?.model ?? '未配置'}
                {settings ? ` · 上限 ${settings.numPredict} tokens` : ''}
              </span>
            </div>

            {aiError && <div className="alert error">解析失败：{aiError}</div>}
            {aiInfo && <div className="alert ok">{aiInfo}</div>}
          </section>

          {/* ---------- AI 结果（可编辑） ---------- */}
          <section className="form-section">
            <button type="button" className="collapse-head" onClick={() => setShowAi((v) => !v)}>
              {showAi ? '▾' : '▸'} 结构化内容（可手动编辑，每行一条）
            </button>
            {showAi && (
              <div className="grid-2">
                <label className="field">
                  <span>岗位职责</span>
                  <textarea
                    rows={6}
                    value={responsibilities}
                    onChange={(e) => setResponsibilities(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>任职要求</span>
                  <textarea
                    rows={6}
                    value={requirements}
                    onChange={(e) => setRequirements(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>技能关键词</span>
                  <textarea rows={4} value={skills} onChange={(e) => setSkills(e.target.value)} />
                </label>
                <label className="field">
                  <span>亮点 / 福利</span>
                  <textarea
                    rows={4}
                    value={highlights}
                    onChange={(e) => setHighlights(e.target.value)}
                  />
                </label>
              </div>
            )}
            <label className="field">
              <span>公司简介</span>
              <textarea
                rows={2}
                value={companyIntro}
                onChange={(e) => setCompanyIntro(e.target.value)}
              />
            </label>
          </section>

          {/* ---------- 其他 ---------- */}
          <section className="form-section">
            <div className="section-title">跟进与其他</div>
            <div className="grid-3">
              <label className="field">
                <span>联系人</span>
                <input value={contact} onChange={(e) => setContact(e.target.value)} />
              </label>
              <label className="field">
                <span>联系方式</span>
                <input value={contactInfo} onChange={(e) => setContactInfo(e.target.value)} />
              </label>
              <label className="field">
                <span>JD 链接</span>
                <input value={jobUrl} onChange={(e) => setJobUrl(e.target.value)} />
              </label>
            </div>
            <label className="field">
              <span>附言 / 求职信</span>
              <textarea
                rows={3}
                value={coverLetter}
                onChange={(e) => setCoverLetter(e.target.value)}
              />
            </label>
            <label className="field">
              <span>备注</span>
              <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </section>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="btn primary" onClick={handleSubmit} disabled={busy}>
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
