/**
 * AI 层：调用本地 Ollama 解析 JD
 *
 * 这里集中处理了三个实测踩出来的坑：
 *  1. 模型有「思考模式」且 think:false 关不掉 —— token 给少了会返回空 content，
 *     所以 num_predict 必须够大，且要做「空回复 → 加大预算重试」。
 *  2. 小模型爱把 JSON 包在 ```json 里 —— 用 Ollama 的 format:'json' 强制约束，
 *     同时保留一层「从文本里抠 JSON」的兜底。
 *  3. 思考内容可能写在 message.thinking 字段 —— 必要时从那里也抠一次。
 */
import fs from 'node:fs'
import path from 'node:path'
import type { OllamaStatus, ParseResult, ParsedJD, Settings } from '../shared/types'
import { getSettings } from './store'

/** 让模型只吐 JSON 的系统提示词 */
export const JD_SYSTEM_PROMPT = `你是求职信息结构化助手。用户会给你一段招聘 JD（可能是纯文本，也可能是招聘网站截图）。

## 任务
从 JD 中抽取信息，输出一个 JSON 对象。

## 输出格式
只输出 JSON，不要任何解释、前言、客套话。

{
  "company": "公司名称",
  "position": "岗位名称",
  "location": "工作地点（城市/区域）",
  "salary": "薪资范围原文",
  "employmentType": "全职|实习|兼职|外包|未提及",
  "experienceRequired": "经验要求，如 3-5年",
  "educationRequired": "学历要求，如 本科及以上",
  "seniority": "初级|中级|高级|专家|管理|未知",
  "responsibilities": ["岗位职责要点"],
  "requirements": ["任职要求要点"],
  "skills": ["硬技能关键词"],
  "highlights": ["福利或亮点"],
  "companyIntro": "公司或业务简介（一句话）",
  "confidence": "high|medium|low",
  "unreadable": ["无法辨认的字段名"]
}

## 规则
1. 只抽取 JD 里明确写出的内容，绝不推测、绝不补充常识。
2. 原文没提到的字段：字符串填 null，数组填空数组 []。
3. 保持原文用词，不要改写、不要翻译、不要润色。
4. responsibilities、requirements、skills 各最多 8 条，按重要性从高到低排列。
5. 每条要点控制在 30 字以内，去掉“负责”“要求”这类重复前缀。
6. 输入是图片且部分文字模糊时：能确认的正常填，无法确认的填 null，并把该字段名加入 unreadable 数组，confidence 填 low。
7. 输出必须是能被 JSON.parse 直接解析的合法 JSON，字符串内不要出现未转义的换行符。`

/** 从可能带 markdown 包裹的文本里抠出第一个 JSON 对象 */
export function extractJson(text: string): any | null {
  if (!text) return null
  let t = text.trim()
  // 去掉 ```json ... ``` 包裹
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  try {
    return JSON.parse(t)
  } catch {
    /* 继续尝试抠花括号 */
  }
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1))
    } catch {
      return null
    }
  }
  return null
}

function asStringOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (s === '' || s === 'null' || s === '未提及' || s === '未知') return null
  return s
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter((x) => x !== '' && x !== 'null')
    .slice(0, 12)
}

/** 把模型返回的任意对象规整成 ParsedJD */
export function coerceParsedJD(raw: any): ParsedJD {
  const confidence =
    raw?.confidence === 'high' || raw?.confidence === 'medium' || raw?.confidence === 'low'
      ? raw.confidence
      : 'low'
  return {
    company: asStringOrNull(raw?.company),
    position: asStringOrNull(raw?.position),
    location: asStringOrNull(raw?.location),
    salary: asStringOrNull(raw?.salary),
    employmentType: asStringOrNull(raw?.employmentType),
    experienceRequired: asStringOrNull(raw?.experienceRequired),
    educationRequired: asStringOrNull(raw?.educationRequired),
    seniority: asStringOrNull(raw?.seniority),
    responsibilities: asStringArray(raw?.responsibilities),
    requirements: asStringArray(raw?.requirements),
    skills: asStringArray(raw?.skills),
    highlights: asStringArray(raw?.highlights),
    companyIntro: asStringOrNull(raw?.companyIntro),
    confidence,
    unreadable: asStringArray(raw?.unreadable),
  }
}

/** 读取图片为 base64（去掉 data URI 前缀） */
export function readImageBase64(file: string): string | null {
  try {
    if (!fs.existsSync(file)) return null
    return fs.readFileSync(file).toString('base64')
  } catch {
    return null
  }
}

interface CallOptions {
  settings: Settings
  userText: string
  imagesBase64: string[]
  numPredict: number
  timeoutMs: number
}

/** 单次调用 Ollama，返回 { content, thinking } */
async function callOllama(opts: CallOptions): Promise<{ content: string; thinking: string }> {
  const { settings, userText, imagesBase64, numPredict, timeoutMs } = opts
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const userMessage: any = {
    role: 'user',
    content: userText.trim() !== '' ? userText : '请解析这张 JD 截图。',
  }
  if (imagesBase64.length > 0) userMessage.images = imagesBase64

  try {
    const res = await fetch(`${settings.ollamaUrl.replace(/\/+$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: settings.model,
        messages: [{ role: 'system', content: JD_SYSTEM_PROMPT }, userMessage],
        // 强制 JSON 输出，避免小模型加 markdown 包裹
        format: 'json',
        // 尽力关闭思考；部分模型不认这个参数，所以下面还有空回复兜底
        think: false,
        stream: false,
        options: {
          num_predict: numPredict,
          temperature: 0.1,
        },
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Ollama 返回 HTTP ${res.status}：${body.slice(0, 300)}`)
    }

    const json: any = await res.json()
    return {
      content: String(json?.message?.content ?? ''),
      thinking: String(json?.message?.thinking ?? ''),
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 解析 JD。
 * 会用 settings.numPredict 起步，若拿不到有效 JSON 则翻倍重试（最多 2 次追加）。
 */
export async function parseJD(payload: {
  text?: string
  imagePaths?: string[]
}): Promise<ParseResult> {
  const settings: Settings = getSettings()
  const images = (payload.imagePaths ?? [])
    .map(readImageBase64)
    .filter((x): x is string => !!x)

  if ((!payload.text || payload.text.trim() === '') && images.length === 0) {
    return { ok: false, error: '没有可解析的内容：请粘贴 JD 文本或选择截图。' }
  }

  let numPredict = settings.numPredict
  let lastRaw = ''
  let lastError = ''

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { content, thinking } = await callOllama({
        settings,
        userText: payload.text ?? '',
        imagesBase64: images,
        numPredict,
        timeoutMs: 240000,
      })

      lastRaw = content || thinking

      // 优先用 content；为空时尝试从 thinking 里抠（思考模型常见）
      let parsed = extractJson(content)
      if (!parsed && thinking) parsed = extractJson(thinking)

      if (parsed) {
        return {
          ok: true,
          data: coerceParsedJD(parsed),
          raw: lastRaw.slice(0, 4000),
          attempts: attempt,
        }
      }

      lastError =
        content.trim() === ''
          ? '模型返回了空内容（思考模式吃掉了 token 预算）'
          : '模型返回的不是合法 JSON'

      // 空回复或 JSON 不合格 —— 加大预算再来一次
      numPredict = Math.min(numPredict * 2, 8192)
    } catch (err: any) {
      lastError = err?.name === 'AbortError' ? '调用超时（本地推理较慢，可改用更小模型或云端）' : String(err?.message ?? err)
      // 网络类错误没必要重试三次
      if (attempt >= 2) break
    }
  }

  return {
    ok: false,
    error: lastError || '解析失败',
    raw: lastRaw.slice(0, 4000),
    attempts: 3,
  }
}

/** 检测 Ollama 是否在运行，并列出可用模型 */
export async function checkOllama(url: string): Promise<OllamaStatus> {
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/api/tags`, {
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return { ok: false, models: [], error: `HTTP ${res.status}` }
    const json: any = await res.json()
    const models: string[] = Array.isArray(json?.models)
      ? json.models.map((m: any) => String(m?.name ?? '')).filter(Boolean)
      : []
    return { ok: true, models }
  } catch (err: any) {
    return { ok: false, models: [], error: String(err?.message ?? err) }
  }
}

/** 供调试：导出提示词原文 */
export function systemPrompt(): string {
  return JD_SYSTEM_PROMPT
}

/** 占位，保持 path 引用（用于未来的路径规范化） */
export function normalizeImagePath(p: string): string {
  return path.normalize(p)
}
