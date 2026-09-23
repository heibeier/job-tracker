/**
 * 数据层：JSON 文件存储
 *
 * 设计取舍：刻意不使用 better-sqlite3 等原生模块，避免 node-gyp / VS 构建工具
 * 依赖导致安装或打包失败。个人投递记录的规模（数百条）用 JSON 完全够用。
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type {
  Application,
  AppStatus,
  NewApplication,
  Settings,
  StatusChange,
} from '../shared/types'
import { DEFAULT_SETTINGS, STATUS_ORDER } from '../shared/types'
import {
  addDays,
  computeFollowUpAt,
  followUpDaysMap,
  stageStartDate,
  todayStr,
} from '../shared/followup'

/** 数据目录：优先读环境变量（便于测试），否则用 Electron 标准 userData */
export function dataDir(): string {
  const override = process.env.JOB_TRACKER_DATA_DIR
  const dir = override && override.trim() !== '' ? override : app.getPath('userData')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function appsFile(): string {
  return path.join(dataDir(), 'applications.json')
}

function settingsFile(): string {
  return path.join(dataDir(), 'settings.json')
}

export function imagesDir(): string {
  const dir = path.join(dataDir(), 'images')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 原子写入：先写临时文件再 rename，避免中途崩溃损坏数据 */
function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = file + '.tmp-' + process.pid
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
}

function isStatus(v: unknown): v is AppStatus {
  return typeof v === 'string' && (STATUS_ORDER as readonly string[]).includes(v)
}

/** 把任意来源的对象补齐成合法 Application（导入的旧数据也能兼容） */
export function normalize(raw: any): Application {
  const now = new Date().toISOString()
  const history: StatusChange[] = Array.isArray(raw?.statusHistory)
    ? raw.statusHistory
        .filter((h: any) => h && isStatus(h.status))
        .map((h: any) => ({
          status: h.status,
          changedAt: str(h.changedAt, now),
          note: typeof h.note === 'string' ? h.note : undefined,
        }))
    : []

  return {
    id: str(raw?.id) || crypto.randomUUID(),
    company: str(raw?.company),
    position: str(raw?.position),
    status: isStatus(raw?.status) ? raw.status : '已投递',
    statusHistory: history,
    appliedAt: str(raw?.appliedAt),
    source: str(raw?.source),
    jobUrl: str(raw?.jobUrl),
    jdText: str(raw?.jdText),
    jdImages: strArray(raw?.jdImages),
    location: str(raw?.location),
    salary: str(raw?.salary),
    employmentType: str(raw?.employmentType),
    experienceRequired: str(raw?.experienceRequired),
    educationRequired: str(raw?.educationRequired),
    responsibilities: strArray(raw?.responsibilities),
    requirements: strArray(raw?.requirements),
    skills: strArray(raw?.skills),
    highlights: strArray(raw?.highlights),
    companyIntro: str(raw?.companyIntro),
    contact: str(raw?.contact),
    contactInfo: str(raw?.contactInfo),
    resumeVersion: str(raw?.resumeVersion),
    coverLetter: str(raw?.coverLetter),
    followUpAt: str(raw?.followUpAt),
    notes: str(raw?.notes),
    tags: strArray(raw?.tags),
    aiMatchScore:
      typeof raw?.aiMatchScore === 'number' && Number.isFinite(raw.aiMatchScore)
        ? raw.aiMatchScore
        : null,
    aiSummary: str(raw?.aiSummary),
    createdAt: str(raw?.createdAt, now),
    updatedAt: str(raw?.updatedAt, now),
  }
}

let cache: Application[] | null = null

export function loadApps(): Application[] {
  if (cache) return cache
  const file = appsFile()
  if (!fs.existsSync(file)) {
    cache = []
    return cache
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    cache = Array.isArray(parsed) ? parsed.map(normalize) : []
  } catch (err) {
    // 数据损坏：备份原文件，从空列表继续，不让应用起不来
    try {
      fs.copyFileSync(file, `${file}.broken-${Date.now()}`)
    } catch {
      /* 备份失败也不阻塞 */
    }
    cache = []
  }
  return cache
}

function persist(list: Application[]): void {
  cache = list
  writeJsonAtomic(appsFile(), list)
}

export function listApps(): Application[] {
  return [...loadApps()].sort((a, b) => (b.appliedAt || '').localeCompare(a.appliedAt || ''))
}

export function getApp(id: string): Application | null {
  return loadApps().find((a) => a.id === id) ?? null
}

export function createApp(input: NewApplication): Application {
  const now = new Date().toISOString()
  const base = normalize({
    ...input,
    id: crypto.randomUUID(),
    status: isStatus(input.status) ? input.status : '已投递',
    appliedAt: input.appliedAt || todayStr(),
    createdAt: now,
    updatedAt: now,
  })
  // 初始状态写入历史，时间线才有起点
  base.statusHistory = [{ status: base.status, changedAt: now }]
  // 建档即进入第一个阶段 → 按该阶段间隔落地一个具体的跟进日期
  // （用户在建档表单里明确填了跟进日期就用他的）
  base.followUpAt = base.followUpAt || computeFollowUpAt(base.appliedAt, base.status, getSettings().followUpDays)

  const list = loadApps()
  list.push(base)
  persist(list)
  return base
}

export function updateApp(id: string, patch: Partial<Application>): Application {
  const list = loadApps()
  const idx = list.findIndex((a) => a.id === id)
  if (idx === -1) throw new Error(`记录不存在: ${id}`)

  const prev = list[idx]
  const next = normalize({ ...prev, ...patch, id: prev.id, createdAt: prev.createdAt })
  next.updatedAt = new Date().toISOString()

  // 状态变化时追加历史
  const statusChanged = !!patch.status && patch.status !== prev.status
  if (statusChanged) {
    next.statusHistory = [
      ...prev.statusHistory,
      { status: next.status, changedAt: next.updatedAt },
    ]
  } else {
    next.statusHistory = prev.statusHistory
  }

  /**
   * 跟进日期：只有「进入新阶段」才自动重算，从今天起算。
   * patch 里显式给了 followUpAt（用户在表单里手改过）就完全尊重他的值，
   * 包括显式清空 —— 那样这条就不再提醒。
   */
  if (patch.followUpAt !== undefined) {
    next.followUpAt = patch.followUpAt
  } else if (statusChanged) {
    next.followUpAt = computeFollowUpAt(todayStr(), next.status, getSettings().followUpDays)
  } else {
    next.followUpAt = prev.followUpAt
  }

  list[idx] = next
  persist(list)
  return next
}

/**
 * 标记「已完成跟进」：按当前阶段的间隔，从今天起顺延一个周期。
 * 从今天算而不是从原跟进日算 —— 逾期三天才跟进的话，下次应该是一周后而不是四天后。
 */
export function completeFollowUp(id: string): Application {
  const list = loadApps()
  const target = list.find((a) => a.id === id)
  if (!target) throw new Error(`记录不存在: ${id}`)

  const days = followUpDaysMap(getSettings().followUpDays)[target.status] ?? 0
  if (days <= 0) return target

  return updateApp(id, { followUpAt: addDays(todayStr(), days) })
}

/**
 * 存量记录补算跟进日期（启动时跑一次）。
 *
 * 只在 followUpAt 为空、且当前阶段是需要提醒的阶段时才填，
 * 所以不会覆盖用户手动设过的日期。
 */
export function backfillFollowUp(): number {
  const list = loadApps()
  const override = getSettings().followUpDays
  let filled = 0

  for (const app of list) {
    if (app.followUpAt) continue
    const next = computeFollowUpAt(stageStartDate(app), app.status, override)
    if (next) {
      app.followUpAt = next
      filled++
    }
  }

  if (filled > 0) persist([...list])
  return filled
}

export function removeApp(id: string): void {
  const list = loadApps()
  const target = list.find((a) => a.id === id)
  // 顺手清理该记录独占的截图文件
  if (target) {
    for (const p of target.jdImages) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p)
      } catch {
        /* 忽略清理失败 */
      }
    }
  }
  persist(list.filter((a) => a.id !== id))
}

/** 导出为 JSON 字符串 */
export function exportJson(): string {
  return JSON.stringify(
    { version: 1, exportedAt: new Date().toISOString(), applications: loadApps() },
    null,
    2,
  )
}

/**
 * 导入 JSON 字符串。
 * merge  —— 按 id 合并（同 id 覆盖，新 id 追加）
 * replace —— 整体替换
 * 返回导入后的记录总数。
 */
export function importJson(json: string, mode: 'merge' | 'replace'): number {
  const parsed = JSON.parse(json)
  const incoming: any[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.applications)
      ? parsed.applications
      : []
  const normalized = incoming.map(normalize)

  if (mode === 'replace') {
    persist(normalized)
    return normalized.length
  }

  const list = loadApps()
  const byId = new Map(list.map((a) => [a.id, a]))
  for (const item of normalized) byId.set(item.id, item)
  const merged = [...byId.values()]
  persist(merged)
  return merged.length
}

/** 把选中的图片复制进数据目录，返回新路径（自包含，原图删了也不影响） */
export function importImages(paths: string[]): string[] {
  const out: string[] = []
  for (const src of paths) {
    try {
      if (!fs.existsSync(src)) continue
      const ext = path.extname(src) || '.png'
      const dest = path.join(imagesDir(), `${crypto.randomUUID()}${ext}`)
      fs.copyFileSync(src, dest)
      out.push(dest)
    } catch {
      /* 单张失败不影响其它 */
    }
  }
  return out
}

/**
 * 保存渲染层粘贴进来的图片（base64）到数据目录，返回文件路径。
 * 剪贴板里的图片没有磁盘路径，必须先落盘才能交给模型解析。
 */
export function savePastedImage(dataBase64: string, ext: string): string {
  const clean = String(ext || 'png')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
  const safeExt = clean === '' ? 'png' : clean === 'jpeg' ? 'jpg' : clean
  const dest = path.join(imagesDir(), `${crypto.randomUUID()}.${safeExt}`)
  fs.writeFileSync(dest, Buffer.from(dataBase64, 'base64'))
  return dest
}

/** 过滤各阶段跟进间隔：只保留合法的非负整数，其余丢弃（回退默认表） */
function numMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (v && typeof v === 'object') {
    const src = v as Record<string, unknown>
    for (const s of STATUS_ORDER) {
      const n = src[s]
      if (typeof n === 'number' && Number.isFinite(n) && n >= 0) out[s] = Math.floor(n)
    }
  }
  return out
}

export function getSettings(): Settings {
  const file = settingsFile()
  if (!fs.existsSync(file)) return { ...DEFAULT_SETTINGS, followUpDays: {} }
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    return {
      ollamaUrl: str(raw?.ollamaUrl, DEFAULT_SETTINGS.ollamaUrl),
      model: str(raw?.model, DEFAULT_SETTINGS.model),
      numPredict:
        typeof raw?.numPredict === 'number' && raw.numPredict >= 256
          ? Math.floor(raw.numPredict)
          : DEFAULT_SETTINGS.numPredict,
      followUpDays: numMap(raw?.followUpDays),
    }
  } catch {
    return { ...DEFAULT_SETTINGS, followUpDays: {} }
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next: Settings = { ...getSettings(), ...patch }
  if (next.numPredict < 256) next.numPredict = DEFAULT_SETTINGS.numPredict
  next.followUpDays = numMap(next.followUpDays)
  writeJsonAtomic(settingsFile(), next)
  return next
}
