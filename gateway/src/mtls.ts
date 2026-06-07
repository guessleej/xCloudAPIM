// 服務間 mTLS（P3-3b）— gateway client 端。
// MTLS_ENABLED=true 時：對「已知內部服務 host」的呼叫改走 https://<host>:MTLS_PORT(9443)
// 並帶 client 憑證；其餘（外部/可設定端點）維持一般 fetch（避免內部 CA 拒絕外部憑證）。
// 未啟用時 internalFetch 等同一般 fetch（可回滾）。
import { Agent, fetch as undiciFetch, type RequestInit } from 'undici'
import { readFileSync } from 'node:fs'

export const MTLS_ENABLED = (process.env['MTLS_ENABLED'] ?? '').toLowerCase() === 'true'
const CERT_DIR = process.env['MTLS_CERT_DIR'] ?? '/etc/mtls'
const MTLS_PORT = process.env['MTLS_PORT'] ?? '9443'

// 僅這些內部服務 host 會被轉為 mTLS（其餘維持原樣）
const INTERNAL_HOSTS = new Set([
  'auth-service', 'registry-service', 'subscription-service', 'policy-engine',
  'gateway', 'bff',
])

let dispatcher: Agent | undefined
if (MTLS_ENABLED) {
  dispatcher = new Agent({
    connect: {
      cert: readFileSync(`${CERT_DIR}/service.crt`),
      key:  readFileSync(`${CERT_DIR}/service.key`),
      ca:   readFileSync(`${CERT_DIR}/ca.crt`),
    },
  })
}

export const mtlsDispatcher = dispatcher

function isInternal(u: string): boolean {
  try {
    return INTERNAL_HOSTS.has(new URL(u).hostname)
  } catch {
    return false
  }
}

/** 內部服務 URL 轉 mTLS 形式（https://host:9443，保留 path/query）；非內部或未啟用時原樣回傳。 */
export function internalUrl(u: string): string {
  if (!MTLS_ENABLED || !isInternal(u)) return u
  const url = new URL(u)
  url.protocol = 'https:'
  url.port = MTLS_PORT
  return url.toString()
}

/** 對服務的 fetch：內部 host 自動轉 mTLS URL + 注入 client 憑證；外部走一般 fetch。 */
export function internalFetch(u: string, init: RequestInit = {}): ReturnType<typeof undiciFetch> {
  if (MTLS_ENABLED && isInternal(u)) {
    return undiciFetch(internalUrl(u), { ...init, dispatcher })
  }
  return undiciFetch(u, init)
}
