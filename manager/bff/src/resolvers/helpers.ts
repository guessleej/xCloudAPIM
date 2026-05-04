import { GraphQLError } from 'graphql'
import type { BffContext } from '../context.js'

export function requireAuth(ctx: BffContext): asserts ctx is BffContext & { user: NonNullable<BffContext['user']> } {
  if (!ctx.user) {
    throw new GraphQLError('Authentication required', {
      extensions: { code: 'UNAUTHENTICATED', http: { status: 401 } },
    })
  }
}

export function requireRole(ctx: BffContext, ...roles: string[]): void {
  requireAuth(ctx)
  if (!roles.includes(ctx.user.role)) {
    throw new GraphQLError(`Insufficient permissions. Required: ${roles.join(' or ')}`, {
      extensions: { code: 'FORBIDDEN', http: { status: 403 } },
    })
  }
}

export function buildPageInfo(page: number, limit: number, total: number) {
  const totalPages = Math.ceil(total / limit)
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  }
}

export function notFound(type: string, id: string): never {
  throw new GraphQLError(`${type} not found: ${id}`, {
    extensions: { code: 'NOT_FOUND', http: { status: 404 } },
  })
}
