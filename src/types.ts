import type { RendererApi } from '../shared/types'

// 把共享类型（含常量）统一从这一处再导出，组件里只 import 这里
export * from '../shared/types'
export * from '../shared/followup'

declare global {
  interface Window {
    api: RendererApi
  }
}
