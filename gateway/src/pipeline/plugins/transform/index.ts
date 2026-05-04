/**
 * Transform Plugin — 請求/回應轉換入口
 *
 * Pre-request 階段執行：
 *   - Request Header 轉換
 *   - Query String 轉換
 *   - Request Body JSON 操作
 *
 * Post-response 階段執行：
 *   - Response Header 轉換
 *   - Response Body JSON 操作
 *
 * config keys 概覽（詳見各子模組）：
 *   request_headers    = '[{"op":"set","name":"X-Client-Id","value":"${ctx.clientId}"}]'
 *   response_headers   = '[{"op":"remove","name":"X-Powered-By"}]'
 *   add_query          = "version=v2;trace=${uuid}"
 *   remove_query       = "debug,secret"
 *   rename_query       = "q:search"
 *   request_body_ops   = '[{"op":"set","path":"$.requestId","value":"${uuid}"}]'
 *   response_body_ops  = '[{"op":"wrap","key":"data"}]'
 *   max_body_bytes     = "1048576"
 */
import { randomUUID } from 'node:crypto'
import type { ExecContext, PluginDeps } from '../../types.js'
import { transformRequestHeaders, transformResponseHeaders } from './headers.js'
import { transformQueryParams }  from './query.js'
import { transformRequestBody, transformResponseBody } from './body.js'

export async function transformPlugin(
  ctx:  ExecContext,
  deps: PluginDeps,
): Promise<void> {
  const cfg   = deps.config
  const phase = ctx.phase

  if (phase === 'pre_request') {
    transformRequestHeaders(ctx, cfg)
    transformQueryParams(ctx, cfg)
    transformRequestBody(ctx, cfg)
    injectStandardHeaders(ctx, cfg)
  } else if (phase === 'post_response') {
    transformResponseHeaders(ctx, cfg)
    transformResponseBody(ctx, cfg)
  }
}

function injectStandardHeaders(ctx: ExecContext, cfg: Record<string, string>): void {
  if (cfg['inject_request_id'] !== 'false') {
    if (!ctx.requestHeaders['x-request-id']) {
      ctx.requestHeaders['x-request-id'] = randomUUID()
    }
  }

  if (cfg['inject_forwarded_for'] !== 'false' && ctx.clientIp) {
    const existing = ctx.requestHeaders['x-forwarded-for']
    ctx.requestHeaders['x-forwarded-for'] = existing
      ? `${existing}, ${ctx.clientIp}`
      : ctx.clientIp
  }

  if (cfg['inject_gateway_id'] !== 'false') {
    ctx.requestHeaders['x-gateway'] = 'xCloudAPIM'
  }
}
