/**
 * 跟进提醒：规则表 + 日期计算（主进程与渲染层共用）
 *
 * 设计要点：**每进入一个阶段，就按该阶段的固定间隔算出一个具体日期**，
 * 写进记录的 followUpAt 字段。这样它在界面上是看得见、能手动改的日子，
 * 而不是藏在代码里、只有程序自己知道的规则。
 *
 * 计时起点是「进入当前阶段的那一天」，不是建档那天：
 *   - 刚建档 → 投递日期
 *   - 改过状态 → 最后一次状态变更的日期
 * 所以同一套规则既能覆盖「投出去一直没动静」，也能覆盖「刚面完在等结果」。
 */
import type { Application, AppStatus } from './types'
import { STATUS_ORDER } from './types'

/**
 * 各阶段默认的跟进间隔（天）。
 * 0 = 该阶段不提醒（Offer 及各种结束态没有催的必要）。
 */
export const DEFAULT_FOLLOW_UP_DAYS: Record<AppStatus, number> = {
  已投递: 7,
  已查看: 7,
  笔试: 14,
  一面: 7,
  二面: 7,
  三面: 7,
  HR面: 5,
  Offer: 0,
  已拒: 0,
  已挂: 0,
  已放弃: 0,
}

/** 阶段显示顺序，设置界面按这个顺序排列 */
export const FOLLOW_UP_STATUSES: AppStatus[] = [...STATUS_ORDER]

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 本地时区的今天，YYYY-MM-DD（不能用 toISOString，那是 UTC，早八点前会差一天） */
export function todayStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** ISO 时间戳 → 本地日历日期 YYYY-MM-DD */
export function isoToLocalDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : todayStr(d)
}

/** 解析 YYYY-MM-DD，返回 UTC 毫秒（只用于算术，避免时区偏移） */
function parseDate(dateStr: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dateStr ?? '').trim())
  if (!m) return NaN
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** 日期加减天数，非法输入返回空字符串 */
export function addDays(dateStr: string, days: number): string {
  const t = parseDate(dateStr)
  if (!Number.isFinite(t)) return ''
  const d = new Date(t + days * 86400000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** a - b 相差几天；任一非法返回 NaN */
export function daysBetween(a: string, b: string): number {
  const ta = parseDate(a)
  const tb = parseDate(b)
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return NaN
  return Math.round((ta - tb) / 86400000)
}

/** 把用户设置里的间隔合并到默认表上（非法值一律忽略，回退默认） */
export function followUpDaysMap(
  override?: Record<string, number> | null,
): Record<AppStatus, number> {
  const out = { ...DEFAULT_FOLLOW_UP_DAYS }
  if (override) {
    for (const s of STATUS_ORDER) {
      const v = override[s]
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[s] = Math.floor(v)
    }
  }
  return out
}

/**
 * 算出跟进日期：阶段起始日 + 该阶段间隔。
 * 不提醒的阶段（间隔为 0）返回空字符串。
 */
export function computeFollowUpAt(
  stageStartDate: string,
  status: AppStatus,
  override?: Record<string, number> | null,
): string {
  const n = followUpDaysMap(override)[status] ?? 0
  if (n <= 0) return ''
  return addDays(stageStartDate, n)
}

/**
 * 计算「进入当前阶段」的日期，作为计时起点。
 * - 从未改过状态：用投递日期。这样补录一条一周前投的记录，进来就是该跟进的状态，
 *   而不是被当成今天刚投的。
 * - 改过状态：用最后一次状态变更的日期，等于「这个阶段已经持续了多久」。
 */
export function stageStartDate(app: Pick<Application, 'appliedAt' | 'statusHistory'>): string {
  const last = app.statusHistory[app.statusHistory.length - 1]
  const changed = last ? isoToLocalDate(last.changedAt) : ''
  if (app.statusHistory.length <= 1) {
    return app.appliedAt || changed || todayStr()
  }
  return changed || app.appliedAt || todayStr()
}

/**
 * 是否已到跟进日期。
 *
 * daysBetween(a, b) 返回 a - b，所以「跟进日已经到或过了」= 跟进日 - 今天 <= 0。
 * 注意这里不能用 >= 0 —— 那会把「还没到期」的记录全判成到期。
 */
export function isFollowUpDue(followUpAt: string, today: string = todayStr()): boolean {
  const d = daysBetween(followUpAt, today)
  return Number.isFinite(d) && d <= 0
}

/**
 * 这条记录现在是否该跟进了。
 * 不提醒的阶段一律返回 false（导入的旧数据可能同时有终态和残留的跟进日期）。
 */
export function isDue(
  app: Pick<Application, 'followUpAt' | 'status'>,
  override?: Record<string, number> | null,
  today: string = todayStr(),
): boolean {
  if ((followUpDaysMap(override)[app.status] ?? 0) <= 0) return false
  return isFollowUpDue(app.followUpAt, today)
}

/** 逾期天数（未到期返回负数，无法计算返回 NaN） */
export function overdueDays(followUpAt: string, today: string = todayStr()): number {
  return daysBetween(today, followUpAt)
}
