import { fetch, Agent, type RequestInit, type Response } from 'undici'
import { config } from '../config/index.js'
import type { RouteEntry } from './route-table.js'

export interface UpstreamRequest {
  method:  string
  path:    string
  query:   string         // raw query string (e.g. "a=1&b=2")
  headers: Record<string, string>
  body?:   Buffer | null
}

export interface UpstreamResponse {
  status:  number
  headers: Record<string, string>
  body:    Buffer
}

// 全域 keep-alive agent（減少 TCP 建立開銷）
const agent = new Agent({
  connections:      256,
  pipelining:       1,
  keepAliveTimeout: config.PROXY_KEEP_ALIVE_TIMEOUT_MS,
  headersTimeout:   config.PROXY_TIMEOUT_MS,
  bodyTimeout:      config.PROXY_TIMEOUT_MS,
})

/** 將請求轉發至上游，回傳原始 response */
export async function forwardRequest(
  route:  RouteEntry,
  req:    UpstreamRequest,
): Promise<UpstreamResponse> {
  // URL 重寫：strip prefix
  let upstreamPath = req.path
  if (route.stripPrefix && upstreamPath.startsWith(route.stripPrefix)) {
    upstreamPath = upstreamPath.slice(route.stripPrefix.length) || '/'
  }

  const upstreamUrl = buildUpstreamUrl(route.upstreamUrl, upstreamPath, req.query)

  // 清除不應轉發至上游的 hop-by-hop headers
  const headers = sanitizeHeaders(req.headers)
  headers['x-forwarded-for'] ??= req.headers['x-real-ip'] ?? ''
  headers['x-forwarded-host'] ??= req.headers['host'] ?? ''

  const init: RequestInit = {
    method:    req.method,
    headers,
    dispatcher: agent,
    signal:    AbortSignal.timeout(config.PROXY_TIMEOUT_MS),
  }
  if (req.body && req.body.length > 0 && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    init.body = req.body
  }

  let resp: Response
  try {
    resp = await fetch(upstreamUrl, init)
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      return { status: 504, headers: {}, body: Buffer.from('upstream timeout') }
    }
    return { status: 502, headers: {}, body: Buffer.from('bad gateway') }
  }

  const respBody = Buffer.from(await resp.arrayBuffer())
  const respHeaders = flattenHeaders(resp.headers)

  return {
    status:  resp.status,
    headers: respHeaders,
    body:    respBody,
  }
}

// ─── helpers ─────────────────────────────────────────────────

function buildUpstreamUrl(base: string, path: string, query: string): string {
  const url = base.replace(/\/$/, '') + (path.startsWith('/') ? path : '/' + path)
  return query ? `${url}?${query}` : url
}

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'te',
  'trailers', 'upgrade', 'proxy-authorization', 'proxy-authenticate',
])

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) {
      out[k] = v
    }
  }
  return out
}

function flattenHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((v, k) => { out[k] = v })
  return out
}
