/**
 * 輕量 HTTP client（undici）
 * 每個 upstream service 一個 Pool，共享 keep-alive 連線
 */
import { Pool, type Dispatcher } from 'undici'
import { config } from '../config/index.js'
import type { Logger } from 'pino'

const pools = new Map<string, Pool>()

function getPool(baseUrl: string): Pool {
  let pool = pools.get(baseUrl)
  if (!pool) {
    pool = new Pool(baseUrl, {
      connections:        16,
      keepAliveTimeout:   60_000,
      keepAliveMaxTimeout: 120_000,
    })
    pools.set(baseUrl, pool)
  }
  return pool
}

export interface RequestOptions {
  method?:  'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path:     string
  body?:    unknown
  headers?: Record<string, string>
  signal?:  AbortSignal
}

export interface ApiResponse<T> {
  data:       T
  statusCode: number
}

export class ServiceClient {
  private pool: Pool
  private baseHeaders: Record<string, string>

  constructor(
    private readonly baseUrl: string,
    private readonly log: Logger,
    extraHeaders?: Record<string, string>,
  ) {
    this.pool = getPool(baseUrl)
    this.baseHeaders = {
      'content-type': 'application/json',
      accept:         'application/json',
      ...extraHeaders,
    }
  }

  async request<T>(opts: RequestOptions): Promise<ApiResponse<T>> {
    const signal = opts.signal ?? AbortSignal.timeout(config.UPSTREAM_TIMEOUT_MS)

    const headers: Record<string, string> = {
      ...this.baseHeaders,
      ...(opts.headers ?? {}),
    }

    const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    if (bodyStr) headers['content-length'] = String(Buffer.byteLength(bodyStr))

    let response: Dispatcher.ResponseData
    try {
      response = await this.pool.request({
        method:  opts.method ?? 'GET',
        path:    opts.path,
        headers,
        body:    bodyStr,
        signal,
      })
    } catch (err) {
      this.log.warn({ err, path: opts.path }, 'upstream request error')
      throw new Error(`upstream service unavailable: ${this.baseUrl}${opts.path}`)
    }

    const raw = await response.body.text()
    const { statusCode } = response

    if (statusCode >= 400) {
      this.log.warn({ statusCode, path: opts.path, body: raw }, 'upstream error response')
      throw new Error(`upstream error ${statusCode}: ${opts.path}`)
    }

    let data: T
    try {
      data = raw ? (JSON.parse(raw) as T) : ({} as T)
    } catch {
      this.log.warn({ path: opts.path, raw }, 'upstream non-JSON response')
      throw new Error(`upstream returned non-JSON: ${opts.path}`)
    }

    return { data, statusCode }
  }

  async get<T>(path: string, headers?: Record<string, string>): Promise<T> {
    const { data } = await this.request<T>({ path, headers })
    return data
  }

  async post<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T> {
    const { data } = await this.request<T>({ method: 'POST', path, body, headers })
    return data
  }

  async put<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T> {
    const { data } = await this.request<T>({ method: 'PUT', path, body, headers })
    return data
  }

  async patch<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T> {
    const { data } = await this.request<T>({ method: 'PATCH', path, body, headers })
    return data
  }

  async delete<T = void>(path: string): Promise<T> {
    const { data } = await this.request<T>({ method: 'DELETE', path })
    return data
  }
}
