import { contextBridge, ipcRenderer } from 'electron'

// preload 스크립트가 로드되었는지 확인
console.log('[Preload] Preload script loaded')

try {
  contextBridge.exposeInMainWorld('electronAPI', {
    // kubectl 명령어 실행
    execKubectl: (args: string[]) => ipcRenderer.invoke('exec-kubectl', args),
    
    // 포트포워딩 시작
    startPortForward: (context: string, namespace: string, pod: string, localPort: number, remotePort: number) =>
      ipcRenderer.invoke('start-port-forward', { context, namespace, pod, localPort, remotePort }),
    
    // 포트포워딩 중지
    stopPortForward: (pid: number) => ipcRenderer.invoke('stop-port-forward', pid),
    
    // 실행 중인 포트포워딩 목록 조회
    getActivePortForwards: () => ipcRenderer.invoke('get-active-port-forwards'),
  })
  console.log('[Preload] electronAPI exposed successfully')
} catch (error) {
  console.error('[Preload] Error exposing electronAPI:', error)
}

