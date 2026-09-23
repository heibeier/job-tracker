/**
 * 主进程与渲染进程共享的类型定义
 */

/** 投递状态（按流程顺序） */
export const STATUS_ORDER = [
  '已投递',
  '已查看',
  '笔试',
  '一面',
  '二面',
  '三面',
  'HR面',
  'Offer',
  '已拒',
  '已挂',
  '已放弃',
] as const

export type AppStatus = (typeof STATUS_ORDER)[number]

/** 已结束的状态（不计入「进行中」） */
export const TERMINAL_STATUSES: AppStatus[] = ['Offer', '已拒', '已挂', '已放弃']

/** 投递渠道 */
export const SOURCE_CHANNELS = [
  'BOSS直聘',
  '猎聘',
  '拉勾',
  '智联招聘',
  '前程无忧',
  '官网',
  '内推',
  '脉脉',
  '其他',
] as const

/** 状态变更历史条目 */
export interface StatusChange {
  status: AppStatus
  changedAt: string
  note?: string
}

/** 一条投递记录 */
export interface Application {
  id: string
  company: string
  position: string
  status: AppStatus
  statusHistory: StatusChange[]
  appliedAt: string
  source: string
  jobUrl: string
  jdText: string
  /** JD 截图的本地绝对路径 */
  jdImages: string[]
  location: string
  salary: string
  employmentType: string
  experienceRequired: string
  educationRequired: string
  responsibilities: string[]
  requirements: string[]
  skills: string[]
  highlights: string[]
  companyIntro: string
  contact: string
  contactInfo: string
  resumeVersion: string
  coverLetter: string
  followUpAt: string
  notes: string
  tags: string[]
  aiMatchScore: number | null
  aiSummary: string
  createdAt: string
  updatedAt: string
}

/** 新建记录时的入参 */
export type NewApplication = Partial<Application> & {
  company: string
  position: string
}

/** 应用设置 */
export interface Settings {
  /** Ollama 服务地址 */
  ollamaUrl: string
  /** 使用的模型名 */
  model: string
  /** 单次生成的最大 token 数（不能太小，否则模型思考会吃掉全部预算导致空回复） */
  numPredict: number
  /**
   * 各阶段的跟进间隔（天），0 = 不提醒。
   * 只需存用户改过的项，缺省项回退到 followup.ts 里的 DEFAULT_FOLLOW_UP_DAYS。
   */
  followUpDays: Record<string, number>
}

export const DEFAULT_SETTINGS: Settings = {
  ollamaUrl: 'http://127.0.0.1:11434',
  model: 'qwen3-vl:4b',
  numPredict: 2400,
  // 空对象 = 全部用默认间隔（默认表在 shared/followup.ts）
  followUpDays: {},
}

/** AI 解析 JD 后的结构化结果 */
export interface ParsedJD {
  company: string | null
  position: string | null
  location: string | null
  salary: string | null
  employmentType: string | null
  experienceRequired: string | null
  educationRequired: string | null
  seniority: string | null
  responsibilities: string[]
  requirements: string[]
  skills: string[]
  highlights: string[]
  companyIntro: string | null
  confidence: 'high' | 'medium' | 'low'
  unreadable: string[]
}

/** 解析结果包装 */
export interface ParseResult {
  ok: boolean
  data?: ParsedJD
  error?: string
  /** 模型原始返回，便于排查 */
  raw?: string
  /** 重试了几次 */
  attempts?: number
}

/** Ollama 连通性检测结果 */
export interface OllamaStatus {
  ok: boolean
  models: string[]
  error?: string
}

/** 预加载脚本暴露给渲染层的 API */
export interface RendererApi {
  list: () => Promise<Application[]>
  get: (id: string) => Promise<Application | null>
  create: (data: NewApplication) => Promise<Application>
  update: (id: string, patch: Partial<Application>) => Promise<Application>
  remove: (id: string) => Promise<void>
  /** 标记「已完成跟进」：按当前阶段的间隔把跟进日期顺延一个周期 */
  followUpDone: (id: string) => Promise<Application>
  exportData: () => Promise<string | null>
  importData: (mode: 'merge' | 'replace') => Promise<number | null>
  getSettings: () => Promise<Settings>
  saveSettings: (patch: Partial<Settings>) => Promise<Settings>
  parseJD: (payload: {
    text?: string
    imagePaths?: string[]
  }) => Promise<ParseResult>
  checkOllama: () => Promise<OllamaStatus>
  pickImages: () => Promise<string[]>
  openPath: (p: string) => Promise<void>
  readImageDataUrl: (p: string) => Promise<string | null>
  /** 把渲染层粘贴进来的图片（base64）存到数据目录，返回文件路径 */
  savePastedImage: (dataBase64: string, ext: string) => Promise<string>
}
