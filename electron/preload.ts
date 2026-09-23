import { contextBridge, ipcRenderer } from 'electron'
import type { Application, NewApplication, RendererApi, Settings } from '../shared/types'

/**
 * 预加载脚本：只把一组明确的方法暴露给渲染层，
 * 渲染层拿不到 Node 能力（contextIsolation 开启）。
 */
const api: RendererApi = {
  list: () => ipcRenderer.invoke('apps:list'),
  get: (id: string) => ipcRenderer.invoke('apps:get', id),
  create: (data: NewApplication) => ipcRenderer.invoke('apps:create', data),
  update: (id: string, patch: Partial<Application>) => ipcRenderer.invoke('apps:update', id, patch),
  remove: (id: string) => ipcRenderer.invoke('apps:delete', id),
  followUpDone: (id: string) => ipcRenderer.invoke('apps:followUpDone', id),
  exportData: () => ipcRenderer.invoke('data:export'),
  importData: (mode: 'merge' | 'replace') => ipcRenderer.invoke('data:import', mode),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:save', patch),
  parseJD: (payload: { text?: string; imagePaths?: string[] }) =>
    ipcRenderer.invoke('ai:parseJD', payload),
  checkOllama: () => ipcRenderer.invoke('ai:check'),
  pickImages: () => ipcRenderer.invoke('dialog:pickImages'),
  openPath: (p: string) => ipcRenderer.invoke('shell:openPath', p),
  readImageDataUrl: (p: string) => ipcRenderer.invoke('fs:readImageDataUrl', p),
  savePastedImage: (dataBase64: string, ext: string) =>
    ipcRenderer.invoke('fs:savePastedImage', dataBase64, ext),
}

contextBridge.exposeInMainWorld('api', api)
