import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { spawn, exec, ChildProcess } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'

const execAsync = promisify(exec)
const __dirname = fileURLToPath(new URL('.', import.meta.url))

let mainWindow: BrowserWindow | null = null

// 포트포워딩 프로세스 추적
const portForwardProcesses = new Map<number, ChildProcess>()

function createWindow() {
  const isDev = process.env.NODE_ENV === 'development'
  
  // 절대 경로로 preload 파일 찾기
  let preloadPath: string
  if (isDev) {
    // 개발 모드: 프로젝트 루트 기준으로 찾기
    const projectRoot = join(__dirname, '../../')
    // .mjs 대신 .js로 변경
    const devPreloadPath = join(projectRoot, 'out/preload/preload.js')
    if (existsSync(devPreloadPath)) {
      preloadPath = devPreloadPath
    } else {
      // 상대 경로로 시도
      preloadPath = join(__dirname, '../preload/preload.js')
    }
  } else {
    preloadPath = join(__dirname, 'preload.js')
  }

  console.log('[Main] Preload path:', preloadPath)
  console.log('[Main] Preload path exists:', existsSync(preloadPath))
  
  if (!existsSync(preloadPath)) {
    console.error('[Main] ERROR: Preload file not found at:', preloadPath)
    console.error('[Main] __dirname:', __dirname)
    console.error('[Main] Current working directory:', process.cwd())
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // preload 스크립트 로드 확인
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[Main] Page loaded, checking electronAPI...')
    // executeJavaScript는 개발자 도구가 열려있지 않으면 실패할 수 있으므로 안전하게 처리
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.executeJavaScript('window.electronAPI ? "API available" : "API not available"')
          .then(result => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              console.log('[Main] electronAPI check:', result)
            }
          })
          .catch(err => {
            // EPIPE 에러는 무시 (개발자 도구가 닫혀있을 때 발생)
            if (err.code !== 'EPIPE') {
              console.error('[Main] electronAPI check error:', err)
            }
          })
      }
    }, 1000) // 페이지 로드 후 1초 대기
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    // 개발자 도구는 수동으로 열도록 (Cmd+Option+I 또는 F12)
    // mainWindow.webContents.openDevTools()
  } else {
    // 프로덕션 빌드: dist/renderer/index.html
    mainWindow.loadFile(join(__dirname, '../dist/renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// kubectl 명령어 실행
ipcMain.handle('exec-kubectl', async (_, args: string[]) => {
  try {
    const command = `kubectl ${args.join(' ')}`
    const { stdout, stderr } = await execAsync(command)
    if (stderr && !stdout) {
      throw new Error(stderr)
    }
    return { success: true, output: stdout, error: null }
  } catch (error: any) {
    return { 
      success: false, 
      output: null, 
      error: error.message || String(error) 
    }
  }
})

// 포트포워딩 시작
ipcMain.handle('start-port-forward', async (_, config: {
  context: string
  namespace: string
  pod: string
  localPort: number
  remotePort: number
}) => {
  try {
    const args = [
      '--context', config.context,
      'port-forward',
      `-n`, config.namespace,
      `pod/${config.pod}`,
      `${config.localPort}:${config.remotePort}`
    ]

    const process = spawn('kubectl', args, {
      stdio: 'pipe',
      detached: false,
    })

    const pid = process.pid
    if (!pid) {
      throw new Error('포트포워딩 프로세스 시작 실패')
    }

    portForwardProcesses.set(pid, process)

    // 프로세스 종료 시 맵에서 제거
    process.on('exit', () => {
      portForwardProcesses.delete(pid)
    })

    // 에러 처리
    process.stderr?.on('data', (data) => {
      const error = data.toString()
      if (error.includes('error') || error.includes('Error')) {
        portForwardProcesses.delete(pid)
      }
    })

    return { success: true, pid, error: null }
  } catch (error: any) {
    return { 
      success: false, 
      pid: null, 
      error: error.message || String(error) 
    }
  }
})

// 포트포워딩 중지
ipcMain.handle('stop-port-forward', async (_, pid: number) => {
  try {
    const childProcess = portForwardProcesses.get(pid)
    if (childProcess) {
      childProcess.kill()
      portForwardProcesses.delete(pid)
      return { success: true, error: null }
    } else {
      // 프로세스가 맵에 없으면 이미 종료된 것으로 간주
      // 시스템 kill 명령어로 시도
      try {
        await execAsync(`kill ${pid}`)
      } catch {
        // 프로세스가 이미 종료된 경우 무시
      }
      return { success: true, error: null }
    }
  } catch (error: any) {
    return { 
      success: false, 
      error: error.message || String(error) 
    }
  }
})

// 실행 중인 포트포워딩 목록 조회
ipcMain.handle('get-active-port-forwards', async () => {
  const activeForwards = Array.from(portForwardProcesses.entries()).map(([pid, process]) => ({
    pid,
    killed: process.killed,
  }))
  return { success: true, forwards: activeForwards }
})

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // 모든 포트포워딩 프로세스 종료
  portForwardProcesses.forEach((process) => {
    process.kill()
  })
  portForwardProcesses.clear()

  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  // 앱 종료 전 모든 포트포워딩 프로세스 종료
  portForwardProcesses.forEach((process) => {
    process.kill()
  })
  portForwardProcesses.clear()
})

