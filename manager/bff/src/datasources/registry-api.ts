import { ServiceClient } from '../http/client.js'
import { config } from '../config/index.js'
import type { Logger } from 'pino'

export interface APIDTO {
  id:              string
  name:            string
  version:         string
  base_path:       string
  upstream_url:    string
  description:     string | null
  status:          string
  org_id:          string
  tags:            string[]
  timeout_ms:      number
  retries:         number
  strip_base_path: boolean
  created_at:      string
  updated_at:      string
}

export interface APIListResponse {
  data:  APIDTO[]
  total: number
  page:  number
  limit: number
}

interface RegistryAPIListResponse {
  items:      APIDTO[]
  total:      number
  page:       number
  page_size:  number
}

export class RegistryAPI {
  private client: ServiceClient

  constructor(log: Logger, extraHeaders?: Record<string, string>) {
    this.client = new ServiceClient(
      config.REGISTRY_SERVICE_URL,
      log,
      extraHeaders,
    )
  }

  async listAPIs(params: {
    orgId?: string
    status?: string
    page?: number
    limit?: number
  }): Promise<APIListResponse> {
    const qs = new URLSearchParams()
    if (params.orgId)  qs.set('org_id', params.orgId)
    if (params.status) qs.set('status', params.status)
    if (params.page)   qs.set('page', String(params.page))
    if (params.limit)  qs.set('page_size', String(params.limit))
    const data = await this.client.get<RegistryAPIListResponse>(`/apis?${qs}`)
    return {
      data:  data.items,
      total: data.total,
      page:  data.page,
      limit: data.page_size,
    }
  }

  async getAPI(id: string): Promise<APIDTO | null> {
    try {
      return await this.client.get<APIDTO>(`/apis/${id}`)
    } catch {
      return null
    }
  }

  async getAPIsByIds(ids: string[]): Promise<APIDTO[]> {
    if (!ids.length) return []
    const results = await Promise.all(ids.map(async (id) => this.getAPI(id)))
    return results.filter((api): api is APIDTO => api !== null)
  }

  async createAPI(input: {
    name:           string
    version:        string
    base_path:      string
    upstream_url:   string
    description?:   string
    org_id:         string
    tags?:          string[]
    timeout_ms?:    number
    retries?:       number
    strip_base_path?: boolean
  }): Promise<APIDTO> {
    return this.client.post<APIDTO>('/apis', input)
  }

  async updateAPI(id: string, input: Partial<APIDTO>): Promise<APIDTO> {
    return this.client.put<APIDTO>(`/apis/${id}`, input)
  }

  async deleteAPI(id: string): Promise<void> {
    await this.client.delete(`/apis/${id}`)
  }
}
