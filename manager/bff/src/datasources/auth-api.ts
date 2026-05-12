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

interface AuthMeResponse {
  id:           string
  email:        string
  display_name: string
  org_id:       string
  org_name:     string
  role:         string
}

function slugifyOrg(name: string, id: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || `org-${id.slice(0, 8)}`
}

function nowIso(): string {
  return new Date().toISOString()
}

function mapMeToUser(me: AuthMeResponse): UserDTO {
  const timestamp = nowIso()
  return {
    id:         me.id,
    email:      me.email,
    name:       me.display_name || me.email,
    role:       me.role,
    org_id:     me.org_id || null,
    created_at: timestamp,
    updated_at: timestamp,
  }
}

function mapMeToOrg(me: AuthMeResponse): OrgDTO | null {
  if (!me.org_id) return null
  const timestamp = nowIso()
  return {
    id:          me.org_id,
    name:        me.org_name || 'Default organization',
    slug:        slugifyOrg(me.org_name || 'default-organization', me.org_id),
    description: null,
    created_at:  timestamp,
    updated_at:  timestamp,
  }
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
    const me = await this.client.get<AuthMeResponse>('/auth/me')
    return mapMeToUser(me)
  }

  async getUserById(id: string): Promise<UserDTO | null> {
    try {
      const user = await this.getMe()
      return user.id === id ? user : null
    } catch {
      return null
    }
  }

  async listOrganizations(page = 1, limit = 20, search?: string): Promise<OrgDTO[]> {
    void page
    void limit
    const me = await this.client.get<AuthMeResponse>('/auth/me')
    const org = mapMeToOrg(me)
    if (!org) return []
    if (search && !org.name.toLowerCase().includes(search.toLowerCase())) return []
    return [org]
  }

  async getOrganization(id: string): Promise<OrgDTO | null> {
    try {
      const me = await this.client.get<AuthMeResponse>('/auth/me')
      const org = mapMeToOrg(me)
      return org?.id === id ? org : null
    } catch {
      return null
    }
  }

  async createOrganization(input: { name: string; slug: string; description?: string }): Promise<OrgDTO> {
    void input
    throw new Error('organization management is handled by auth registration in this deployment')
  }

  async updateOrganization(id: string, input: Partial<OrgDTO>): Promise<OrgDTO> {
    void id
    void input
    throw new Error('organization management is handled by auth registration in this deployment')
  }

  async deleteOrganization(id: string): Promise<void> {
    void id
    throw new Error('organization deletion is not supported in this deployment')
  }
}
