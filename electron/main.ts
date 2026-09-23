import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import * as store from './store'
import { parseJD, checkOllama } from './ai'
import type { Application, NewApplication, Settings } from '../shared/types'

const devServerUrl = process.env.VITE_DEV_SERVER_URL

let mainWindow: BrowserWindow | null = null

/**
 * 固定数据目录为 %APPDATA%\job-tracker。
 *
 * 不这么做的话，Electron 会用 app.getName() 推导 userData 路径 —— 开发模式下是
 * "job-tracker"，打包后变成 productName「求职投递记录」，同一份数据会在两个位置
 * 各存一份，用户会以为记录丢了。显式设置后两种模式共用同一目录。
 */
app.setPath('userData', path.join(app.getPath('appData'), 'job-tracker'))

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1040,
    minHeight: 660,
    title: '求职投递记录',
    backgroundColor: '#f5f6f8',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    // dist-electron/electron/main.js -> 项目根/dist/index.html
    void mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/** 把本地图片读成 data URL，供渲染层显示（避免 file:// 在开发模式下被拦） */
function toDataUrl(file: string): string | null {
  try {
    if (!fs.existsSync(file)) return null
    const ext = path.extname(file).slice(1).toLowerCase()
    const mime =
      ext === 'jpg' || ext === 'jpeg'
        ? 'image/jpeg'
        : ext === 'webp'
          ? 'image/webp'
          : ext === 'gif'
            ? 'image/gif'
            : ext === 'bmp'
              ? 'image/bmp'
              : 'image/png'
    return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`
  } catch {
    return null
  }
}

function registerIpc(): void {
  // ---- 记录增删改查 ----
  ipcMain.handle('apps:list', () => store.listApps())
  ipcMain.handle('apps:get', (_e, id: string) => store.getApp(id))
  ipcMain.handle('apps:create', (_e, data: NewApplication) => store.createApp(data))
  ipcMain.handle('apps:update', (_e, id: string, patch: Partial<Application>) =>
    store.updateApp(id, patch),
  )
  ipcMain.handle('apps:delete', (_e, id: string) => {
    store.removeApp(id)
    return true
  })
  ipcMain.handle('apps:followUpDone', (_e, id: string) => store.completeFollowUp(id))

  // ---- 导入 / 导出 ----
  ipcMain.handle('data:export', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出投递记录',
      defaultPath: `投递记录-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [
        { name: 'JSON', extensions: ['json'] },
        { name: 'CSV', extensions: ['csv'] },
      ],
    })
    if (canceled || !filePath) return null

    if (filePath.toLowerCase().endsWith('.csv')) {
      fs.writeFileSync(filePath, toCsv(store.listApps()), 'utf8')
    } else {
      fs.writeFileSync(filePath, store.exportJson(), 'utf8')
    }
    return filePath
  })

  ipcMain.handle('data:import', async (_e, mode: 'merge' | 'replace') => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '导入投递记录',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (canceled || filePaths.length === 0) return null
    const json = fs.readFileSync(filePaths[0], 'utf8')
    return store.importJson(json, mode)
  })

  // ---- 设置 ----
  ipcMain.handle('settings:get', () => store.getSettings())
  ipcMain.handle('settings:save', (_e, patch: Partial<Settings>) => store.saveSettings(patch))

  // ---- AI ----
  ipcMain.handle('ai:parseJD', (_e, payload: { text?: string; imagePaths?: string[] }) =>
    parseJD(payload ?? {}),
  )
  ipcMain.handle('ai:check', () => checkOllama(store.getSettings().ollamaUrl))

  // ---- 文件选择 / 打开 ----
  ipcMain.handle('dialog:pickImages', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '选择 JD 截图',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
      properties: ['openFile', 'multiSelections'],
    })
    if (canceled || filePaths.length === 0) return []
    // 复制进数据目录，保证自包含（原图被删也不影响）
    return store.importImages(filePaths)
  })

  ipcMain.handle('shell:openPath', (_e, p: string) => shell.openPath(p))
  ipcMain.handle('fs:readImageDataUrl', (_e, p: string) => toDataUrl(p))
  // 支持在搜索框 / 任意位置 Ctrl+V 粘贴截图：剪贴板图片没有磁盘路径，先落盘
  ipcMain.handle('fs:savePastedImage', (_e, dataBase64: string, ext: string) =>
    store.savePastedImage(dataBase64, ext),
  )
}

/** 简易 CSV 导出（按逗号转义） */
function toCsv(list: Application[]): string {
  const headers = [
    '公司',
    '岗位',
    '状态',
    '投递日期',
    '渠道',
    '城市',
    '薪资',
    '经验要求',
    '学历要求',
    '技能',
    '跟进日期',
    '投递简历版本',
    'JD链接',
    '备注',
  ]
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const rows = list.map((a) =>
    [
      a.company,
      a.position,
      a.status,
      a.appliedAt,
      a.source,
      a.location,
      a.salary,
      a.experienceRequired,
      a.educationRequired,
      a.skills.join('/'),
      a.followUpAt,
      a.resumeVersion,
      a.jobUrl,
      a.notes,
    ]
      .map(esc)
      .join(','),
  )
  // 加 BOM，Excel 打开中文不乱码
  return '\uFEFF' + [headers.join(','), ...rows].join('\r\n')
}

/** 关于对话框 */
function showAbout(): void {
  void dialog.showMessageBox({
    type: 'info',
    title: '关于',
    message: '求职投递记录',
    detail: [
      `版本 ${app.getVersion()}`,
      '',
      '本地投递记录管理工具：记录投递过的公司、岗位与 JD，',
      '管理投递状态与后续跟进，支持用本地模型自动解析 JD。',
      '',
      `数据目录：${app.getPath('userData')}`,
    ].join('\n'),
    buttons: ['确定'],
    noLink: true,
  })
}

/**
 * 中文应用菜单。
 *
 * Electron 内置的默认菜单是英文的（File / Edit / View / Window / Help），
 * 必须在应用启动时用 Menu.setApplicationMenu 覆盖，否则界面上会残留英文。
 * 这里同时给出中文 label 和原生 role —— role 负责行为，label 负责显示。
 */
function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '重新加载',
          accelerator: 'F5',
          click: () => mainWindow?.webContents.reload(),
        },
        { type: 'separator' },
        { label: '退出', role: 'quit' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载页面', role: 'reload' },
        { label: '强制重新加载', role: 'forceReload' },
        { label: '开发者工具', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '实际大小', role: 'resetZoom' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { type: 'separator' },
        { label: '全屏', role: 'togglefullscreen' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', role: 'minimize' },
        { label: '关闭', role: 'close' },
      ],
    },
    {
      label: '帮助',
      submenu: [{ label: '关于', click: showAbout }],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  // 存量记录（本功能上线前建的）补算跟进日期，只填空值，不覆盖已有的
  try {
    const n = store.backfillFollowUp()
    if (n > 0) console.log(`[跟进提醒] 为 ${n} 条存量记录补算了跟进日期`)
  } catch (err) {
    console.error('[跟进提醒] 补算失败：', err)
  }

  buildMenu()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
