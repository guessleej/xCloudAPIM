import { ServiceClient } from '../http/client.js'
import { config } from '../config/index.js'
import type { Logger } from 'pino'

export interface PlanDTO {
  id:          string
  name:        string
  description: string | null
  rpm_limit:   number
  rpd_limit:   number
  rph_limit:   number
  max_keys:    number
  price:       number
  currency:    string
  features:    string[]
  is_public:   boolean
  created_at:  string
}

export interface SubscriptionDTO {
  id:         string
  org_id:     string
  plan_id:    string
  api_id:     string
  status:     string
  expires_at: string | null
  created_at: string
  updated_at: string
}

export interface SubscriptionListResponse {
  data:  SubscriptionDTO[]
  total: number
  page:  number
  limit: number
}

export interface APIKeyDTO {
  id:              string
  key_id:          string
  subscription_id: string
  name:            string
  status:          string
  allowed_ips:     string[]
  allowed_origins: string[]
  scopes:          string[]
  expires_at:      string | null
  last_used_at:    string | null
  created_at:      string
}

export class SubscriptionAPI {
  private client: ServiceClient

  constructor(log: Logger, authHeader?: string) {
    this.client = new ServiceClient(
      config.SUBSCRIPTION_SERVICE_URL,
      log,
      authHeader ? { authorization: authHeader } : {},
    )
  }

  // ─── Plans ────────────────────────────────────────────────────
  async listPlans(isPublic?: boolean): Promise<PlanDTO[]> {
    const qs = new URLSearchParams()
    if (isPublic !== undefined) qs.set('is_public', String(isPublic))
    return this.client.get<PlanDTO[]>(`/v1/plans?${qs}`)
  }

  async getPlan(id: string): Promise<PlanDTO | null> {
    try {
      return await this.client.get<PlanDTO>(`/v1/plans/${id}`)
    } catch {
      return null
    }
  }

  async getPlansByIds(ids: string[]): Promise<PlanDTO[]> {
    if (!ids.length) return []
    const qs = new URLSearchParams({ ids: ids.join(',') })
    return this.client.get<PlanDTO[]>(`/v1/plans/batch?${qs}`)
  }

  async createPlan(input: Partial<PlanDTO>): Promise<PlanDTO> {
    return this.client.post<PlanDTO>('/v1/plans', input)
  }

  async updatePlan(id: string, input: Partial<PlanDTO>): Promise<PlanDTO> {
    return this.client.put<PlanDTO>(`/v1/plans/${id}`, input)
  }

  async deletePlan(id: string): Promise<void> {
    await this.client.delete(`/v1/plans/${id}`)
  }

  // ─── Subscriptions ────────────────────────────────────────────
  async listSubscriptions(params: {
    orgId?:  string
    apiId?:  string
    status?: string
    page?:   number
    limit?:  number
  }): Promise<SubscriptionListResponse> {
    const qs = new URLSearchParams()
    if (params.orgId)  qs.set('org_id', params.orgId)
    if (params.apiId)  qs.set('api_id', params.apiId)
    if (params.status) qs.set('status', params.status)
    if (params.page)   qs.set('page', String(params.page))
    if (params.limit)  qs.set('limit', String(params.limit))
    return this.client.get<SubscriptionListResponse>(`/v1/subscriptions?${qs}`)
  }

  async getSubscription(id: string): Promise<SubscriptionDTO | null> {
    try {
      return await this.client.get<SubscriptionDTO>(`/v1/subscriptions/${id}`)
    } catch {
      return null
    }
  }

  async getSubscriptionsByIds(ids: string[]): Promise<SubscriptionDTO[]> {
    if (!ids.length) return []
    const qs = new URLSearchParams({ ids: ids.join(',') })
    return this.client.get<SubscriptionDTO[]>(`/v1/subscriptions/batch?${qs}`)
  }

  async createSubscription(input: {
    org_id:     string
    plan_id:    string
    api_id:     string
    expires_at?: string
  }): Promise<SubscriptionDTO> {
    return this.client.post<SubscriptionDTO>('/v1/subscriptions', input)
  }

  async updateSubscriptionStatus(id: string, status: string): Promise<SubscriptionDTO> {
    return this.client.patch<SubscriptionDTO>(`/v1/subscriptions/${id}/status`, { status })
  }

  // ─── API Keys ─────────────────────────────────────────────────
  async listAPIKeys(subscriptionId: string, status?: string): Promise<APIKeyDTO[]> {
    const qs = new URLSearchParams({ subscription_id: subscriptionId })
    if (status) qs.set('status', status)
    return this.client.get<APIKeyDTO[]>(`/v1/keys?${qs}`)
  }

  async getAPIKey(id: string): Promise<APIKeyDTO | null> {
    try {
      return await this.client.get<APIKeyDTO>(`/v1/keys/${id}`)
    } catch {
      return null
    }
  }

  async createAPIKey(input: {
    subscription_id: string
    name:            string
    allowed_ips?:    string[]
    allowed_origins?: string[]
    scopes?:         string[]
    expires_at?:     string
  }): Promise<APIKeyDTO> {
    return this.client.post<APIKeyDTO>('/v1/keys', input)
  }

  async revokeAPIKey(id: string): Promise<APIKeyDTO> {
    return this.client.patch<APIKeyDTO>(`/v1/keys/${id}/revoke`, {})
  }
}
