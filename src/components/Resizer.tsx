import { useCallback, useEffect, useRef, useState } from 'react'

/** 面板宽度的约束与默认值 */
export interface WidthRange {
  /** 最小宽度（px） */
  min: number
  /** 最大宽度（px）。窗口过窄时由 App 传入更小的值动态收紧 */
  max: number
  /** 双击手柄时恢复到的默认宽度（px） */
  default: number
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(v)))
}

/**
 * 面板宽度状态：用户拖出来的宽度写进 localStorage，重开应用仍然保持。
 *
 * 为什么把「夹紧」做成派生值而不是 useEffect 回写 state：
 * max 会随窗口尺寸变化。收窄窗口时把宽度压小是临时的，不能覆盖用户原本
 * 拖出来的宽度，否则窗口再放大就回不去了。所以只有用户主动拖动才落盘。
 */
export function usePanelWidth(key: string, range: WidthRange) {
  const { min, max, default: fallback } = range

  const [raw, setRaw] = useState<number>(() => {
    const stored = Number(window.localStorage.getItem(key))
    return Number.isFinite(stored) && stored > 0 ? clamp(stored, min, max) : fallback
  })

  const width = clamp(raw, min, max)

  const setWidth = useCallback(
    (next: number) => {
      const v = clamp(next, min, max)
      setRaw(v)
      try {
        window.localStorage.setItem(key, String(v))
      } catch {
        /* 存储不可用（隐私模式/配额满）也不该影响拖拽本身 */
      }
    },
    [key, min, max],
  )

  const reset = useCallback(() => setWidth(fallback), [setWidth, fallback])

  return { width, setWidth, reset }
}

interface ResizerProps {
  /** 被拖面板当前**实际渲染**的宽度，作为拖拽起点 */
  width: number
  min: number
  max: number
  /**
   * 手柄相对被拖面板的位置，决定拖动方向：
   * - `right` 面板在手柄左侧（左侧筛选栏），光标右移 = 变宽
   * - `left`  面板在手柄右侧（右侧详情栏），光标左移 = 变宽
   */
  side: 'right' | 'left'
  onDrag: (width: number) => void
  /** 双击手柄时调用 */
  onReset?: () => void
  /** 读屏用的说明文字 */
  label: string
}

/** 方向键每次调整的像素数 */
const STEP = 16

/**
 * 左右面板之间的拖拽手柄。
 *
 * 用 pointer 事件而不是 mouse 事件，触摸屏/触控笔同样可用；
 * 拖拽期间监听挂在 window 上，光标移出手柄甚至移出窗口也不会丢事件。
 */
export default function Resizer({ width, min, max, side, onDrag, onReset, label }: ResizerProps) {
  const [dragging, setDragging] = useState(false)
  /** 组件在拖拽途中被卸载时，用它收尾，避免 window 上残留监听 */
  const endDrag = useRef<(() => void) | null>(null)

  useEffect(() => () => endDrag.current?.(), [])

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    // 阻止拖拽时选中文字 / 触发浏览器原生拖放
    e.preventDefault()

    const startX = e.clientX
    const startWidth = width
    const toWidth = (clientX: number) => {
      const delta = clientX - startX
      return startWidth + (side === 'right' ? delta : -delta)
    }

    setDragging(true)
    // 拖拽时全局锁定光标形状并禁止选中文字
    document.body.classList.add('resizing')

    /**
     * 监听**同步**挂上，不放进 useEffect。
     * 否则指针快速移动时，pointermove 可能在 React 提交副作用之前就到了，
     * 事件会被丢掉（或按错误的起点计算）。
     */
    const onMove = (ev: PointerEvent) => onDrag(toWidth(ev.clientX))
    const stop = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      document.body.classList.remove('resizing')
      endDrag.current = null
      setDragging(false)
    }

    endDrag.current = stop
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const step = (e.key === 'ArrowRight' ? STEP : -STEP) * (side === 'right' ? 1 : -1)
    onDrag(width + step)
  }

  return (
    <div
      className={`resizer ${dragging ? 'dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={Math.round(max)}
      tabIndex={0}
      title="拖动调整宽度 · 双击恢复默认"
      onPointerDown={handlePointerDown}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
    />
  )
}
