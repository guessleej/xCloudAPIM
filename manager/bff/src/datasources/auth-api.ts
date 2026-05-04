import { ServiceClient } from '../http/client.js'
import { config } from '../config/index.js'
import type { Logger } from 'pino'

export interface UserDTO {
  id:         string
  email:      string
  name:       string
  role:       string
  org_id:     string | null
  created_at: string
  updated_at: string
}

export interface OrgDTO {
  id:          string
  name:        string
  slug:        string
  description: string | null
  created_at:  string
  updated_at:  string
}

export class AuthAPI {
  private client: ServiceClient

  constructor(log: Logger, authHeader?: string) {
    this.client = new ServiceClient(
      config.AUTH_SERVICE_URL,
      log,
      authHeader ? { authorization: authHeader } : {},
    )
  }

  async getMe(): Promise<UserDTO> {
    return this.client.get<UserDTO>('/v1/users/me')
  }

  async getUserById(id: string): Promise<UserDTO | null> {
    try {
      return await this.client.get<UserDTO>(`/v1/users/${id}`)
    } catch {
      return null
    }
  }

  async listOrganizations(page = 1, limit = 20, search?: string): Promise<OrgDTO[]> {
    const qs = new URLSearchParams({ page: String(page), limit: String(limit) })
    if (search) qs.set('search', search)
    return this.client.get<OrgDTO[]>(`/v1/organizations?${qs}`)
  }

  async getOrganization(id: string): Promise<OrgDTO | null> {
    try {
      return await this.client.get<OrgDTO>(`/v1/organizations/${id}`)
    } catch {
      return null
    }
  }

  async createOrganization(input: { name: string; slug: string; description?: string }): Promise<OrgDTO> {
    return this.client.post<OrgDTO>('/v1/organizations', input)
  }

  async updateOrganization(id: string, input: Partial<OrgDTO>): Promise<OrgDTO> {
    return this.client.put<OrgDTO>(`/v1/organizations/${id}`, input)
  }

  async deleteOrganization(id: string): Promise<void> {
    await this.client.delete(`/v1/organizations/${id}`)
  }
}
