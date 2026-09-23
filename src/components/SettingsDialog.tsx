import { useState } from 'react'
import type { Settings } from '../types'
import { DEFAULT_FOLLOW_UP_DAYS, FOLLOW_UP_STATUSES, followUpDaysMap } from '../types'

interface Props {
  settings: Settings
  onClose: () => void
  onSaved: (s: Settings) => void
}

/** 设置弹窗：本地模型配置 + 跟进提醒间隔 */
export default function SettingsDialog({ settings, onClose, onSaved }: Props) {
  const [ollamaUrl, setOllamaUrl] = useState(settings.ollamaUrl)
  const [model, setModel] = useState(settings.model)
  const [numPredict, setNumPredict] = useState(String(settings.numPredict))
  /** 各阶段跟进间隔（天），字符串形式方便输入框编辑 */
  const [followDays, setFollowDays] = useState<Record<string, string>>(() => {
    const merged = followUpDaysMap(settings.followUpDays)
    return Object.fromEntries(FOLLOW_UP_STATUSES.map((s) => [s, String(merged[s] ?? 0)]))
  })
  const [models, setModels] = useState<string[] | null>(null)
  const [testing, setTesting] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  async function test() {
    setTesting(true)
    setMsg('')
    setErr('')
    try {
      const res = await window.api.checkOllama()
      if (res.ok) {
        setModels(res.models)
        setMsg(
          res.models.length > 0
            ? `连接正常，本机有 ${res.models.length} 个模型`
            : '连接正常，但本机还没有任何模型',
        )
      } else {
        setModels([])
        setErr(`连接失败：${res.error ?? '未知错误'}。请确认 Ollama 正在运行。`)
      }
    } catch (e: any) {
      setErr(String(e?.message ?? e))
    } finally {
      setTesting(false)
    }
  }

  async function save() {
    const n = Number(numPredict)
    if (!Number.isFinite(n) || n < 256) {
      setErr('token 上限至少填 256（建议 2000 以上，太小会导致空回复）')
      return
    }

    // 跟进间隔：只收合法非负整数，非法项直接丢弃（回退默认值）
    const parsedFollowUp: Record<string, number> = {}
    for (const s of FOLLOW_UP_STATUSES) {
      const v = Number(followDays[s])
      if (!Number.isFinite(v) || v < 0) {
        setErr(`「${s}」的跟进间隔要填 0 或正整数（0 = 不提醒）`)
        return
      }
      parsedFollowUp[s] = Math.floor(v)
    }

    const saved = await window.api.saveSettings({
      ollamaUrl: ollamaUrl.trim(),
      model: model.trim(),
      numPredict: Math.floor(n),
      followUpDays: parsedFollowUp,
    })
    onSaved(saved)
    onClose()
  }

  /** 把某阶段改回默认间隔 */
  function resetOne(status: string) {
    setFollowDays((prev) => ({ ...prev, [status]: String(DEFAULT_FOLLOW_UP_DAYS[status as never] ?? 0) }))
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>设置</h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          <section className="form-section">
            <div className="section-title">本地模型（Ollama）</div>

            <label className="field">
              <span>服务地址</span>
              <input
                value={ollamaUrl}
                onChange={(e) => setOllamaUrl(e.target.value)}
                placeholder="http://127.0.0.1:11434"
              />
            </label>

            <label className="field">
              <span>模型名称</span>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                list="model-options"
                placeholder="qwen3-vl:4b"
              />
              <datalist id="model-options">
                {(models ?? []).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>

            <label className="field">
              <span>单次生成 token 上限</span>
              <input
                type="number"
                min={256}
                step={256}
                value={numPredict}
                onChange={(e) => setNumPredict(e.target.value)}
              />
              <small className="hint">
                这个模型有「思考模式」且关不掉，token 给少了会返回空内容。建议保持 2000 以上。
              </small>
            </label>

            <div className="ai-bar">
              <button type="button" className="btn" onClick={test} disabled={testing}>
                {testing ? '检测中…' : '测试连接'}
              </button>
            </div>

            {msg && <div className="alert ok">{msg}</div>}
            {err && <div className="alert error">{err}</div>}

            {models && models.length > 0 && (
              <div className="model-list">
                {models.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`model-chip ${m === model ? 'active' : ''}`}
                    onClick={() => setModel(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* ---------- 跟进提醒 ---------- */}
          <section className="form-section">
            <div className="section-title">
              跟进提醒
              <span className="hint-inline">进入各阶段后隔多少天提醒你跟进（0 = 不提醒）</span>
            </div>

            <div className="followup-grid">
              {FOLLOW_UP_STATUSES.map((s) => {
                const isDefault = String(DEFAULT_FOLLOW_UP_DAYS[s]) === followDays[s]
                return (
                  <label className="followup-item" key={s}>
                    <span className={`dot status-${s}`} />
                    <span className="fu-status">{s}</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={followDays[s] ?? '0'}
                      onChange={(e) =>
                        setFollowDays((prev) => ({ ...prev, [s]: e.target.value }))
                      }
                    />
                    <span className="fu-unit">天</span>
                    <button
                      type="button"
                      className="fu-reset"
                      title={isDefault ? '已是默认值' : `恢复默认 ${DEFAULT_FOLLOW_UP_DAYS[s]} 天`}
                      disabled={isDefault}
                      onClick={() => resetOne(s)}
                    >
                      ↺
                    </button>
                  </label>
                )
              })}
            </div>
          </section>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn primary" onClick={save}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
