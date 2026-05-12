import { ServiceClient } from '../http/client.js'
import { config } from '../config/index.js'
import type { Logger } from 'pino'

export interface PlanDTO {
  id:          string
  name:        string
  description: string | null
  rpm_limit:   number
  rpd_limit:   number
  rph_limit:   number | null
  max_api_keys: number
  price_cents: number
  currency:    string
  features:    Record<string, unknown> | null
  is_public:   boolean
  created_at:  string
}

export interface SubscriptionDTO {
  id:         string
  organization_id: string
  plan_id:    string
  api_id:     string
  status:     string
  end_date:   string | null
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
  key_prefix:      string
  subscription_id: string
  name:            string
  status:          string
  allowed_ips:     string[]
  allowed_origins: string[]
  scopes:          string[]
  expires_at:      string | null
  last_used_at:    string | null
  created_at:      string
  key?:            string
}

export class SubscriptionAPI {
  private client: ServiceClient

  constructor(log: Logger, extraHeaders?: Record<string, string>) {
    this.client = new ServiceClient(
      config.SUBSCRIPTION_SERVICE_URL,
      log,
      extraHeaders,
    )
  }

  // ─── Plans ────────────────────────────────────────────────────
  async listPlans(isPublic?: boolean): Promise<PlanDTO[]> {
    const qs = new URLSearchParams()
    if (isPublic !== undefined) qs.set('is_public', String(isPublic))
    const data = await this.client.get<{ plans: PlanDTO[] }>(`/v1/plans?${qs}`)
    return data.plans
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
    const results = await Promise.all(ids.map(async (id) => this.getPlan(id)))
    return results.filter((plan): plan is PlanDTO => plan !== null)
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
    if (params.apiId)  qs.set('api_id', params.apiId)
    if (params.status) qs.set('status', params.status)
    if (params.page)   qs.set('page', String(params.page))
    if (params.limit)  qs.set('size', String(params.limit))
    const data = await this.client.get<{
      subscriptions: SubscriptionDTO[] | null
      total: number
    }>(`/v1/subscriptions?${qs}`)
    const subscriptions = data.subscriptions ?? []
    return {
      data: subscriptions,
      total: data.total,
      page: params.page ?? 1,
      limit: params.limit ?? subscriptions.length,
    }
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
    const results = await Promise.all(ids.map(async (id) => this.getSubscription(id)))
    return results.filter((sub): sub is SubscriptionDTO => sub !== null)
  }

  async createSubscription(input: {
    org_id:     string
    plan_id:    string
    api_id:     string
    expires_at?: string
  }): Promise<SubscriptionDTO> {
    return this.client.post<SubscriptionDTO>('/v1/subscriptions', {
      api_id:  input.api_id,
      plan_id: input.plan_id,
    })
  }

  async updateSubscriptionStatus(id: string, status: string): Promise<SubscriptionDTO> {
    if (status === 'cancelled') {
      await this.client.put<void>(`/v1/subscriptions/${id}/cancel`, {})
      const sub = await this.getSubscription(id)
      if (!sub) throw new Error(`subscription not found after cancel: ${id}`)
      return sub
    }
    if (status === 'active') {
      await this.client.put<void>(`/v1/subscriptions/${id}/approve`, {})
      const sub = await this.getSubscription(id)
      if (!sub) throw new Error(`subscription not found after approve: ${id}`)
      return sub
    }
    if (status === 'suspended') {
      await this.client.put<void>(`/v1/subscriptions/${id}/suspend`, { reason: 'suspended via portal' })
      const sub = await this.getSubscription(id)
      if (!sub) throw new Error(`subscription not found after suspend: ${id}`)
      return sub
    }
    throw new Error(`unsupported subscription status transition: ${status}`)
  }

  // ─── API Keys ─────────────────────────────────────────────────
  async listAPIKeys(subscriptionId: string, status?: string): Promise<APIKeyDTO[]> {
    const data = await this.client.get<{ keys: APIKeyDTO[] }>(`/v1/subscriptions/${subscriptionId}/keys`)
    return status
      ? data.keys.filter((key) => key.status === status)
      : data.keys
  }

  async getAPIKey(id: string): Promise<APIKeyDTO | null> {
    throw new Error(`getAPIKey is not supported without subscription context: ${id}`)
  }

  async createAPIKey(input: {
    subscription_id: string
    name:            string
    allowed_ips?:    string[]
    allowed_origins?: string[]
    scopes?:         string[]
    expires_at?:     string
  }): Promise<APIKeyDTO> {
    return this.client.post<APIKeyDTO>(`/v1/subscriptions/${input.subscription_id}/keys`, {
      name: input.name,
      allowed_ips: input.allowed_ips,
      allowed_origins: input.allowed_origins,
      scopes: input.scopes,
      expires_at: input.expires_at,
    })
  }

  async revokeAPIKey(subscriptionId: string, id: string): Promise<void> {
    await this.client.request<void>({
      method: 'DELETE',
      path: `/v1/subscriptions/${subscriptionId}/keys/${id}`,
      body: { reason: 'revoked via portal' },
    })
  }
}
