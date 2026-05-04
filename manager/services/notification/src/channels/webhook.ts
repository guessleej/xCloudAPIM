/**
 * Webhook 發送（undici + exponential backoff retry）
 */
import { fetch } from 'undici'
import type { Logger } from 'pino'
import { config } from '../config/index.js'
import { renderWebhook } from '../templates/index.js'

export async function sendWebhook(
  url:       string,
  eventType: string,
  data:      Record<string, unknown>,
  log:       Logger,
  secret?:   string,
): Promise<{ ok: boolean; statusCode?: number; error?: string }> {
  const body = renderWebhook(eventType, data) ?? JSON.stringify(data)

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-xcloudapim-event': eventType,
    'x-xcloudapim-timestamp': String(Math.floor(Date.now() / 1000)),
  }

  // HMAC 簽章（若設定了 secret）
  if (secret) {
    const { createHmac } = await import('node:crypto')
    const sig = createHmac('sha256', secret).update(body).digest('hex')
    headers['x-xcloudapim-signature'] = `sha256=${sig}`
  }

  let lastErr = ''
  for (let attempt = 0; attempt < config.WEBHOOK_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = config.WEBHOOK_RETRY_BASE_MS * Math.pow(2, attempt - 1)
      await sleep(delay)
    }

    try {
      const resp = await fetch(url, {
        method:  'POST',
        headers,
        body,
        signal:  AbortSignal.timeout(config.WEBHOOK_TIMEOUT_MS),
      })

      if (resp.ok || (resp.status >= 400 && resp.status < 500)) {
        // 4xx = 不可重試（endpoint 拒絕）
        if (!resp.ok) {
          log.warn({ url, eventType, status: resp.status }, 'webhook rejected 4xx')
          return { ok: false, statusCode: resp.status, error: `4xx: ${resp.status}` }
        }
        log.info({ url, eventType, attempt: attempt + 1 }, 'webhook sent')
        return { ok: true, statusCode: resp.status }
      }

      lastErr = `status ${resp.status}`
      log.warn({ url, eventType, attempt: attempt + 1, status: resp.status }, 'webhook 5xx, will retry')
    } catch (err) {
      lastErr = err instanceof Error ? err.message : 'network error'
      log.warn({ url, eventType, attempt: attempt + 1, err }, 'webhook error, will retry')
    }
  }

  return { ok: false, error: `max retries exceeded: ${lastErr}` }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
