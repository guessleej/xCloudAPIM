/**
 * 模板變數解析
 * 支援：${ctx.clientId} ${ctx.userId} ${ctx.plan} ${ctx.apiId}
 *        ${request.header.<name>} ${request.query.<name>}
 *        ${env.<NAME>} ${now} ${uuid}
 */
import { randomUUID } from 'node:crypto'
import type { ExecContext } from '../../types.js'

const ENV_ALLOW_LIST = new Set<string>([
  'ENVIRONMENT', 'SERVICE_NAME', 'REGION', 'VERSION',
])

export function resolveTemplate(template: string, ctx: ExecContext): string {
  return template.replace(/\$\{([^}]+)\}/g, (_, expr: string) => {
    return resolveExpr(expr.trim(), ctx)
  })
}

function resolveExpr(expr: string, ctx: ExecContext): string {
  if (expr === 'now')  return String(Math.floor(Date.now() / 1000))
  if (expr === 'uuid') return randomUUID()

  if (expr.startsWith('ctx.')) {
    const field = expr.slice(4)
    switch (field) {
      case 'clientId':       return ctx.clientId       ?? ''
      case 'userId':         return ctx.userId         ?? ''
      case 'plan':           return ctx.plan           ?? ''
      case 'apiId':          return ctx.apiId          ?? ''
      case 'subscriptionId': return ctx.subscriptionId ?? ''
      case 'orgId':          return ctx.orgId          ?? ''
      default:               return ''
    }
  }

  if (expr.startsWith('request.header.')) {
    const name = expr.slice('request.header.'.length).toLowerCase()
    return ctx.requestHeaders[name] ?? ''
  }

  if (expr.startsWith('request.query.')) {
    const name = expr.slice('request.query.'.length)
    return ctx.queryParams[name] ?? ''
  }

  if (expr.startsWith('env.')) {
    const name = expr.slice(4).toUpperCase()
    if (ENV_ALLOW_LIST.has(name)) return process.env[name] ?? ''
    return ''
  }

  return ''
}
