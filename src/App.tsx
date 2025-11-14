import React, { useState, useEffect, useCallback } from 'react'
import { ContextTabs } from './components/ContextTabs'
import { NamespaceList } from './components/NamespaceList'
import { PodList } from './components/PodList'
import { useKubectl } from './hooks/useKubectl'
import { usePortForward } from './hooks/usePortForward'
import { getAllowedNamespaces } from './utils/config'
import type { KubernetesContext, Namespace, Pod, PortForwardConfig } from './types'
import './App.css'

function App() {
  const { fetchContexts, fetchNamespaces, fetchPods } = useKubectl()
  const { startPortForward, stopPortForward } = usePortForward()

  const [contexts, setContexts] = useState<KubernetesContext[]>([])
  const [activeContext, setActiveContext] = useState<string | null>(null)
  const [namespaces, setNamespaces] = useState<Namespace[]>([])
  const [visibleNamespaces, setVisibleNamespaces] = useState<Set<string>>(new Set())
  const [podsByNamespace, setPodsByNamespace] = useState<Map<string, Pod[]>>(new Map())
  const [portForwards, setPortForwards] = useState<Map<string, Map<string, Map<number, PortForwardConfig>>>>(new Map())
  const [refreshing, setRefreshing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 초기 컨텍스트 로드
  useEffect(() => {
    loadContexts()
  }, [])

  // 컨텍스트 변경 시 네임스페이스 및 Pod 로드
  useEffect(() => {
    if (activeContext) {
      loadDataForContext(activeContext)
    }
  }, [activeContext])

  const loadContexts = async () => {
    setError(null)
    try {
      const loadedContexts = await fetchContexts()
      
      if (loadedContexts.length === 0) {
        setError('사용 가능한 Kubernetes 컨텍스트가 없습니다. kubectl config get-contexts로 확인해주세요.')
        return
      }
      
      setContexts(loadedContexts)
      
      // 현재 컨텍스트 또는 첫 번째 컨텍스트를 활성화
      const currentContext = loadedContexts.find(ctx => ctx.current) || loadedContexts[0]
      if (currentContext) {
        setActiveContext(currentContext.name)
      }
    } catch (error: any) {
      const errorMessage = error?.message || '컨텍스트를 로드할 수 없습니다'
      console.error('컨텍스트 로드 실패:', error)
      setError(errorMessage)
    }
  }

  const loadDataForContext = async (context: string) => {
    setLoading(true)
    setError(null)
    try {
      // 네임스페이스 로드만 수행 (Pod는 선택 시 로드)
      const loadedNamespaces = await fetchNamespaces(context)
      setNamespaces(loadedNamespaces)
      
      // 기본적으로 모든 네임스페이스 비활성화
      setVisibleNamespaces(new Set())

      // Pod는 선택된 네임스페이스에 대해서만 로드하므로 여기서는 초기화만
      setPodsByNamespace(new Map())
    } catch (error: any) {
      const errorMessage = error?.message || '데이터를 로드할 수 없습니다'
      console.error('데이터 로드 실패:', error)
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  // 선택된 네임스페이스의 Pod를 로드 (병렬 처리)
  const loadPodsForNamespaces = useCallback(async (context: string, namespaceNames: string[], setLoadingState: boolean = true) => {
    if (namespaceNames.length === 0) {
      setPodsByNamespace(new Map())
      return
    }

    if (setLoadingState) {
      setLoading(true)
    }
    try {
      // 병렬로 모든 네임스페이스의 Pod 로드
      // 이미 로드된 네임스페이스도 포함하여 최신 데이터로 갱신
      const podPromises = namespaceNames.map(async (namespace) => {
        try {
          const pods = await fetchPods(context, namespace)
          return { namespace, pods }
        } catch (error) {
          console.error(`네임스페이스 ${namespace}의 Pod 로드 실패:`, error)
          return { namespace, pods: [] }
        }
      })

      const results = await Promise.all(podPromises)
      
      // 기존 Pod 데이터와 병합
      setPodsByNamespace(prev => {
        const newMap = new Map(prev)
        results.forEach(({ namespace, pods }) => {
          newMap.set(namespace, pods)
        })
        return newMap
      })
    } catch (error) {
      console.error('Pod 로드 실패:', error)
    } finally {
      if (setLoadingState) {
        setLoading(false)
      }
    }
  }, [fetchPods])

  const handleRefresh = async (context: string) => {
    setRefreshing(true)
    try {
      // 현재 선택된 네임스페이스를 저장
      const currentSelectedNamespaces = Array.from(visibleNamespaces)
      
      // 네임스페이스 목록만 새로고침 (선택은 유지)
      setLoading(true)
      setError(null)
      try {
        const loadedNamespaces = await fetchNamespaces(context)
        setNamespaces(loadedNamespaces)
        
        // 선택된 네임스페이스 복원 (로드된 네임스페이스 중에서만)
        const validSelectedNamespaces = currentSelectedNamespaces.filter(ns => 
          loadedNamespaces.some(loadedNs => loadedNs.name === ns)
        )
        setVisibleNamespaces(new Set(validSelectedNamespaces))
        
        // 선택된 네임스페이스의 Pod만 다시 로드 (로딩 상태는 handleRefresh에서 관리)
        if (validSelectedNamespaces.length > 0) {
          await loadPodsForNamespaces(context, validSelectedNamespaces, false)
        } else {
          // 선택된 네임스페이스가 없으면 Pod 데이터 초기화
          setPodsByNamespace(new Map())
        }
      } catch (error: any) {
        const errorMessage = error?.message || '데이터를 로드할 수 없습니다'
        console.error('데이터 로드 실패:', error)
        setError(errorMessage)
      } finally {
        setLoading(false)
      }
    } finally {
      setRefreshing(false)
    }
  }

  const handleContextChange = (context: string) => {
    setActiveContext(context)
  }

  const handleToggleNamespace = (namespace: string) => {
    setVisibleNamespaces(prev => {
      const newSet = new Set(prev)
      if (newSet.has(namespace)) {
        newSet.delete(namespace)
        // Pod 데이터도 제거 (메모리 최적화)
        setPodsByNamespace(prevPods => {
          const newPods = new Map(prevPods)
          newPods.delete(namespace)
          return newPods
        })
      } else {
        newSet.add(namespace)
        // 새로 선택된 네임스페이스의 Pod 로드 (이미 로드된 경우에도 최신 데이터로 갱신)
        if (activeContext) {
          loadPodsForNamespaces(activeContext, [namespace])
        }
      }
      return newSet
    })
  }

  const handlePortForwardChange = useCallback(async (
    podName: string,
    remotePort: number,
    localPort: number,
    enabled: boolean
  ) => {
    if (!activeContext) return

    // Pod가 속한 네임스페이스 찾기
    let podNamespace = ''
    for (const [namespace, pods] of podsByNamespace.entries()) {
      if (pods.some(pod => pod.name === podName)) {
        podNamespace = namespace
        break
      }
    }

    if (!podNamespace) {
      console.error('Pod의 네임스페이스를 찾을 수 없습니다:', podName)
      return
    }

    const configKey = `${activeContext}:${podNamespace}:${podName}`

    if (enabled) {
      // 포트포워딩 시작
      try {
        const pid = await startPortForward(
          activeContext,
          podNamespace,
          podName,
          localPort,
          remotePort
        )

        const config: PortForwardConfig = {
          id: `${configKey}:${remotePort}`,
          context: activeContext,
          namespace: podNamespace,
          pod: podName,
          localPort,
          remotePort,
          pid,
          active: true,
        }

        setPortForwards(prev => {
          const newMap = new Map(prev)
          if (!newMap.has(activeContext)) {
            newMap.set(activeContext, new Map())
          }
          const contextMap = newMap.get(activeContext)!
          if (!contextMap.has(podNamespace)) {
            contextMap.set(podNamespace, new Map())
          }
          const namespaceMap = contextMap.get(podNamespace)!
          if (!namespaceMap.has(podName)) {
            namespaceMap.set(podName, new Map())
          }
          const podMap = namespaceMap.get(podName)!
          podMap.set(remotePort, config)
          return newMap
        })
      } catch (error) {
        console.error('포트포워딩 시작 실패:', error)
        alert(`포트포워딩 시작 실패: ${error instanceof Error ? error.message : String(error)}`)
      }
    } else {
      // 포트포워딩 중지
      const contextMap = portForwards.get(activeContext)
      const namespaceMap = contextMap?.get(podNamespace)
      const podMap = namespaceMap?.get(podName)
      const config = podMap?.get(remotePort)

      if (config?.pid) {
        try {
          await stopPortForward(config.pid)
          
          setPortForwards(prev => {
            const newMap = new Map(prev)
            const ctxMap = newMap.get(activeContext)
            const nsMap = ctxMap?.get(podNamespace)
            const pMap = nsMap?.get(podName)
            if (pMap) {
              pMap.delete(remotePort)
              if (pMap.size === 0) {
                nsMap?.delete(podName)
                if (nsMap?.size === 0) {
                  ctxMap?.delete(podNamespace)
                  if (ctxMap?.size === 0) {
                    newMap.delete(activeContext)
                  }
                }
              }
            }
            return newMap
          })
        } catch (error) {
          console.error('포트포워딩 중지 실패:', error)
          alert(`포트포워딩 중지 실패: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
  }, [activeContext, podsByNamespace, portForwards, startPortForward, stopPortForward])

  // 현재 컨텍스트의 보이는 네임스페이스의 Pod 목록
  const visiblePods = React.useMemo(() => {
    if (!activeContext) return []
    
    const allPods: Pod[] = []
    for (const namespace of visibleNamespaces) {
      const pods = podsByNamespace.get(namespace) || []
      allPods.push(...pods)
    }
    return allPods
  }, [activeContext, visibleNamespaces, podsByNamespace])

  // 현재 컨텍스트의 포트포워딩 맵 (Pod 이름 -> 포트 번호 -> 설정)
  const currentPortForwards = React.useMemo(() => {
    if (!activeContext) return new Map()
    
    const contextMap = portForwards.get(activeContext) || new Map()
    const result = new Map<string, Map<number, PortForwardConfig>>()
    
    for (const [namespace, namespaceMap] of contextMap.entries()) {
      if (visibleNamespaces.has(namespace)) {
        for (const [podName, podMap] of namespaceMap.entries()) {
          result.set(podName, podMap)
        }
      }
    }
    
    return result
  }, [activeContext, portForwards, visibleNamespaces])

  return (
    <div className="app">
      <ContextTabs
        contexts={contexts}
        activeContext={activeContext}
        onContextChange={handleContextChange}
        onRefresh={handleRefresh}
        refreshing={refreshing}
      />
      <div className="app-content">
        <NamespaceList
          namespaces={namespaces}
          visibleNamespaces={visibleNamespaces}
          onToggleNamespace={handleToggleNamespace}
          onSelectAll={() => {
            const allowedNamespacesSet = getAllowedNamespaces()
            const allowedNamespaces = namespaces
              .filter(ns => allowedNamespacesSet.has(ns.name))
              .map(ns => ns.name)
            setVisibleNamespaces(new Set(allowedNamespaces))
            // 선택된 모든 네임스페이스의 Pod 병렬 로드
            if (activeContext) {
              loadPodsForNamespaces(activeContext, allowedNamespaces)
            }
          }}
          onDeselectAll={() => {
            setVisibleNamespaces(new Set())
            setPodsByNamespace(new Map())
          }}
          onSelectOnly={(namespace) => {
            setVisibleNamespaces(new Set([namespace]))
            // 선택된 네임스페이스의 Pod만 로드
            if (activeContext) {
              loadPodsForNamespaces(activeContext, [namespace])
            }
          }}
        />
        <div className="main-content">
          {error ? (
            <div className="error-state">
              <div className="error-message">
                <h3>오류 발생</h3>
                <p>{error}</p>
                <button 
                  className="retry-button"
                  onClick={() => {
                    if (activeContext) {
                      loadDataForContext(activeContext)
                    } else {
                      loadContexts()
                    }
                  }}
                >
                  다시 시도
                </button>
              </div>
            </div>
          ) : loading ? (
            <div className="loading-state">
              <div className="loading-spinner"></div>
              <p>로딩 중...</p>
            </div>
          ) : (
            <PodList
              pods={visiblePods}
              portForwards={currentPortForwards}
              onPortForwardChange={handlePortForwardChange}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default App

