/**
 * 애플리케이션 설정 유틸리티
 * 환경 변수에서 설정을 읽어옵니다.
 */

/**
 * 허용된 네임스페이스 목록을 반환합니다.
 * 환경 변수 VITE_ALLOWED_NAMESPACES에서 읽어오며, 쉼표로 구분된 문자열입니다.
 * 환경 변수가 설정되지 않은 경우 빈 Set을 반환합니다.
 */
export function getAllowedNamespaces(): Set<string> {
  const envValue = import.meta.env.VITE_ALLOWED_NAMESPACES
  
  if (!envValue || typeof envValue !== 'string') {
    console.warn('VITE_ALLOWED_NAMESPACES가 설정되지 않았습니다. .env 파일을 확인하세요.')
    return new Set<string>()
  }

  // 쉼표로 구분된 문자열을 배열로 변환하고, 공백 제거
  const namespaces = envValue
    .split(',')
    .map(ns => ns.trim())
    .filter(ns => ns.length > 0)

  return new Set(namespaces)
}

