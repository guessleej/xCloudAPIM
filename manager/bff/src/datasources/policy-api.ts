import { ServiceClient } from '../http/client.js'
import { config } from '../config/index.js'
import type { Logger } from 'pino'

export interface PolicyDTO {
  id:        string
  type:      string
  phase:     string
  order:     number
  enabled:   boolean
  config:    Record<string, string>
  condition: string | null
}

export interface PolicyChainDTO {
  chain_id:   string
  api_id:     string
  version:    number
  etag:       string
  policies:   PolicyDTO[]
  updated_at: string | null
}

export interface PublishChainInput {
  policies: Array<{
    type:      string
    phase:     string
    order:     number
    enabled:   boolean
    config:    Record<string, string>
    condition?: string
  }>
}

export class PolicyAPI {
  private client: ServiceClient

  constructor(log: Logger, authHeader?: string) {
    this.client = new ServiceClient(
      config.POLICY_ENGINE_URL,
      log,
      authHeader ? { authorization: authHeader } : {},
    )
  }

  async getPolicyChain(apiId: string): Promise<PolicyChainDTO | null> {
    try {
      return await this.client.get<PolicyChainDTO>(`/v1/chains/${apiId}`)
    } catch {
      return null
    }
  }

  async publishPolicyChain(apiId: string, input: PublishChainInput): Promise<PolicyChainDTO> {
    return this.client.post<PolicyChainDTO>(`/v1/chains/${apiId}`, input)
  }

  async validatePolicyChain(apiId: string, input: PublishChainInput): Promise<{ valid: boolean; warnings: string[] }> {
    return this.client.post(`/v1/chains/${apiId}/validate`, input)
  }

  async invalidateCache(apiId: string): Promise<void> {
    await this.client.delete(`/v1/chains/${apiId}/cache`)
  }
}
