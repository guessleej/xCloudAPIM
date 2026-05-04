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

export class RegistryAPI {
  private client: ServiceClient

  constructor(log: Logger, authHeader?: string) {
    this.client = new ServiceClient(
      config.REGISTRY_SERVICE_URL,
      log,
      authHeader ? { authorization: authHeader } : {},
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
    if (params.limit)  qs.set('limit', String(params.limit))
    return this.client.get<APIListResponse>(`/v1/apis?${qs}`)
  }

  async getAPI(id: string): Promise<APIDTO | null> {
    try {
      return await this.client.get<APIDTO>(`/v1/apis/${id}`)
    } catch {
      return null
    }
  }

  async getAPIsByIds(ids: string[]): Promise<APIDTO[]> {
    if (!ids.length) return []
    const qs = new URLSearchParams({ ids: ids.join(',') })
    return this.client.get<APIDTO[]>(`/v1/apis/batch?${qs}`)
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
    return this.client.post<APIDTO>('/v1/apis', input)
  }

  async updateAPI(id: string, input: Partial<APIDTO>): Promise<APIDTO> {
    return this.client.put<APIDTO>(`/v1/apis/${id}`, input)
  }

  async deleteAPI(id: string): Promise<void> {
    await this.client.delete(`/v1/apis/${id}`)
  }
}
