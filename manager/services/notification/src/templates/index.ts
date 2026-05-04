/**
 * Handlebars 模板渲染
 * 支援 HTML email 與 Webhook JSON body
 */
import Handlebars from 'handlebars'

// ─── Email 模板 ────────────────────────────────────────────────

const EMAIL_TEMPLATES: Record<string, { subject: string; html: string; text: string }> = {
  quota_exceeded: {
    subject: '[xCloudAPIM] 配額超限警告 — {{apiName}}',
    html: `
<h2>API 配額超限警告</h2>
<p>您的 API <strong>{{apiName}}</strong> 已超過 <strong>{{window}}</strong> 配額限制。</p>
<table>
  <tr><td>API</td><td>{{apiName}}</td></tr>
  <tr><td>Client</td><td>{{clientId}}</td></tr>
  <tr><td>視窗</td><td>{{window}}</td></tr>
  <tr><td>限制</td><td>{{limit}}</td></tr>
  <tr><td>實際用量</td><td>{{actual}}</td></tr>
  <tr><td>時間</td><td>{{ts}}</td></tr>
</table>
<p>請考慮升級計劃或聯繫管理員。</p>`,
    text: `[配額超限] API: {{apiName}}, Client: {{clientId}}, 視窗: {{window}}, 限制: {{limit}}, 用量: {{actual}}`,
  },

  subscription_expiry: {
    subject: '[xCloudAPIM] 訂閱即將到期 — {{planName}}',
    html: `
<h2>訂閱即將到期</h2>
<p>您的訂閱計劃 <strong>{{planName}}</strong> 將於 <strong>{{expiresAt}}</strong> 到期。</p>
<p>到期後 API 存取將中斷，請儘早續約。</p>`,
    text: `訂閱計劃 {{planName}} 將於 {{expiresAt}} 到期，請儘早續約。`,
  },

  api_key_revoked: {
    subject: '[xCloudAPIM] API Key 已撤銷',
    html: `
<h2>API Key 撤銷通知</h2>
<p>API Key <strong>{{keyId}}</strong> 已於 {{ts}} 被撤銷。</p>
<p>如有疑問請聯繫管理員。</p>`,
    text: `API Key {{keyId}} 已於 {{ts}} 被撤銷。`,
  },

  subscription_activated: {
    subject: '[xCloudAPIM] 訂閱已啟用 — {{planName}}',
    html: `<h2>訂閱啟用通知</h2><p>您的訂閱計劃 <strong>{{planName}}</strong> 已成功啟用。</p>`,
    text: `訂閱計劃 {{planName}} 已成功啟用。`,
  },

  subscription_cancelled: {
    subject: '[xCloudAPIM] 訂閱已取消 — {{planName}}',
    html: `<h2>訂閱取消通知</h2><p>訂閱計劃 <strong>{{planName}}</strong> 已取消。</p>`,
    text: `訂閱計劃 {{planName}} 已取消。`,
  },
}

// ─── Webhook 模板 ──────────────────────────────────────────────

const WEBHOOK_TEMPLATES: Record<string, string> = {
  quota_exceeded:         '{"event":"quota.exceeded","apiId":"{{apiId}}","clientId":"{{clientId}}","window":"{{window}}","limit":{{limit}},"actual":{{actual}},"ts":"{{ts}}"}',
  subscription_expiry:    '{"event":"subscription.expiry","subscriptionId":"{{subscriptionId}}","planName":"{{planName}}","expiresAt":"{{expiresAt}}"}',
  api_key_revoked:        '{"event":"api_key.revoked","keyId":"{{keyId}}","ts":"{{ts}}"}',
  subscription_activated: '{"event":"subscription.activated","subscriptionId":"{{subscriptionId}}","planName":"{{planName}}"}',
  subscription_cancelled: '{"event":"subscription.cancelled","subscriptionId":"{{subscriptionId}}","planName":"{{planName}}"}',
}

// ─── Compiled cache ────────────────────────────────────────────

const compiledEmail   = new Map<string, ReturnType<typeof Handlebars.compile>>()
const compiledWebhook = new Map<string, ReturnType<typeof Handlebars.compile>>()

export interface RenderedEmail {
  subject: string
  html:    string
  text:    string
}

export function renderEmail(eventType: string, data: Record<string, unknown>): RenderedEmail | null {
  const tpl = EMAIL_TEMPLATES[eventType]
  if (!tpl) return null

  const renderSubject = getCached(compiledEmail, `${eventType}_subject`, tpl.subject)
  const renderHtml    = getCached(compiledEmail, `${eventType}_html`,    tpl.html)
  const renderText    = getCached(compiledEmail, `${eventType}_text`,    tpl.text)

  return {
    subject: renderSubject(data),
    html:    renderHtml(data),
    text:    renderText(data),
  }
}

export function renderWebhook(eventType: string, data: Record<string, unknown>): string | null {
  const tplStr = WEBHOOK_TEMPLATES[eventType]
  if (!tplStr) return null
  const render = getCached(compiledWebhook, eventType, tplStr)
  return render(data)
}

function getCached(
  cache: Map<string, ReturnType<typeof Handlebars.compile>>,
  key: string,
  source: string,
): ReturnType<typeof Handlebars.compile> {
  let fn = cache.get(key)
  if (!fn) { fn = Handlebars.compile(source); cache.set(key, fn) }
  return fn
}
