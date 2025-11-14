export interface ElectronAPI {
  execKubectl: (args: string[]) => Promise<{
    success: boolean
    output: string | null
    error: string | null
  }>
  startPortForward: (
    context: string,
    namespace: string,
    pod: string,
    localPort: number,
    remotePort: number
  ) => Promise<{
    success: boolean
    pid: number | null
    error: string | null
  }>
  stopPortForward: (pid: number) => Promise<{
    success: boolean
    error: string | null
  }>
  getActivePortForwards: () => Promise<{
    success: boolean
    forwards: Array<{ pid: number; killed: boolean }>
  }>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

