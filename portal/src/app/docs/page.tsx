import type { Metadata } from 'next'
import Link from 'next/link'
import {
  BookOpen, Key, Zap, Shield, AlertCircle,
  ArrowRight, CheckCircle2, Code2, Globe,
} from 'lucide-react'
import CodeBlock from '@/components/docs/CodeBlock'

export const metadata: Metadata = {
  title: '開發者文件',
  description: 'xCloudAPIM Developer Portal 快速入門指南：認證、API Key、速率限制、錯誤碼一次掌握。',
}

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'https://api.example.com'

// ─── Section 目錄 ────────────────────────────────────────────────

const sections = [
  { id: 'quickstart',  label: '快速開始',     icon: Zap },
  { id: 'auth',        label: '認證方式',     icon: Shield },
  { id: 'apikey',      label: 'API Key',      icon: Key },
  { id: 'ratelimit',   label: '速率限制',     icon: Globe },
  { id: 'errors',      label: '錯誤碼',       icon: AlertCircle },
  { id: 'sdks',        label: '程式碼範例',   icon: Code2 },
]

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Page header ────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
          <div className="flex items-center gap-3 mb-3">
            <BookOpen className="text-brand-600" size={26} />
            <h1 className="text-3xl font-bold text-gray-900">開發者文件</h1>
          </div>
          <p className="text-gray-500 max-w-2xl">
            歡迎使用 xCloudAPIM Developer Portal。本文件涵蓋認證、速率限制、錯誤碼與程式碼範例，
            協助您快速完成 API 整合。
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex flex-col lg:flex-row gap-10">

          {/* ── Sidebar TOC ──────────────────────────────────────── */}
          <nav className="lg:w-52 shrink-0">
            <div className="sticky top-6 bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 px-2">目錄</p>
              <ul className="space-y-0.5">
                {sections.map(({ id, label, icon: Icon }) => (
                  <li key={id}>
                    <a
                      href={`#${id}`}
                      className="flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm text-gray-600
                                 hover:bg-brand-50 hover:text-brand-700 transition-colors"
                    >
                      <Icon size={14} className="shrink-0" />
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
              <div className="mt-4 pt-4 border-t border-gray-100">
                <Link
                  href="/apis"
                  className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-brand-600
                             hover:bg-brand-50 transition-colors font-medium"
                >
                  <ArrowRight size={14} />
                  瀏覽 API 目錄
                </Link>
              </div>
            </div>
          </nav>

          {/* ── Main content ──────────────────────────────────────── */}
          <article className="flex-1 space-y-14 min-w-0">

            {/* ── 快速開始 ─────────────────────────────────────── */}
            <section id="quickstart">
              <SectionTitle icon={Zap} title="快速開始" />
              <div className="prose-like space-y-4">
                <p className="text-gray-600 leading-relaxed">
                  只需三個步驟即可完成第一個 API 呼叫：
                </p>
                <ol className="space-y-3">
                  {[
                    { step: '1', text: '前往 API 目錄，找到您想使用的 API 並訂閱方案' },
                    { step: '2', text: '在「我的訂閱 → API Keys」建立 API Key' },
                    { step: '3', text: '在請求 Header 帶入 X-API-Key 即可呼叫' },
                  ].map(({ step, text }) => (
                    <li key={step} className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-brand-600 text-white text-xs
                                       font-bold flex items-center justify-center mt-0.5">
                        {step}
                      </span>
                      <span className="text-gray-700">{text}</span>
                    </li>
                  ))}
                </ol>
                <CodeBlock
                  language="bash"
                  title="最簡單的 API 呼叫"
                  code={`curl -X GET "${GATEWAY_URL}/your-api/v1/resource" \\
  -H "X-API-Key: xca_your_api_key_here" \\
  -H "Accept: application/json"`}
                />
                <div className="flex flex-wrap gap-3 pt-1">
                  <Link
                    href="/apis"
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-brand-600 text-white
                               text-sm font-semibold rounded-xl hover:bg-brand-700 transition-colors"
                  >
                    瀏覽 API 目錄 <ArrowRight size={14} />
                  </Link>
                  <Link
                    href="/auth/register"
                    className="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-300
                               text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    免費註冊
                  </Link>
                </div>
              </div>
            </section>

            {/* ── 認證方式 ─────────────────────────────────────── */}
            <section id="auth">
              <SectionTitle icon={Shield} title="認證方式" />
              <div className="space-y-6">
                <p className="text-gray-600">
                  xCloudAPIM 支援兩種主要的 API 認證方式。每個 API 的允許認證方式在其說明文件中標示。
                </p>
                <div className="grid sm:grid-cols-2 gap-4">
                  <AuthMethodCard
                    title="API Key"
                    badge="推薦入門"
                    badgeColor="green"
                    desc="最簡單的認證方式。在請求 Header 帶入 X-API-Key 即可，適合伺服器對伺服器的呼叫。"
                    checks={['無需 OAuth 流程', '永不過期（可手動撤銷）', '易於管理多個 Key']}
                  />
                  <AuthMethodCard
                    title="JWT / Bearer Token"
                    badge="進階"
                    badgeColor="blue"
                    desc="透過 OAuth 2.0 Client Credentials 取得 Access Token，適合需要細粒度權限控管的場景。"
                    checks={['支援 Scope 控管', '短期有效（自動刷新）', '適合使用者操作情境']}
                  />
                </div>
              </div>
            </section>

            {/* ── API Key ──────────────────────────────────────── */}
            <section id="apikey">
              <SectionTitle icon={Key} title="API Key 使用方式" />
              <div className="space-y-5">
                <p className="text-gray-600">
                  API Key 以 <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono text-brand-700">xca_</code> 前綴開頭。
                  可透過三種方式傳遞：
                </p>
                <CodeBlock
                  language="bash"
                  title="方法 1：X-API-Key Header（建議）"
                  code={`curl "${GATEWAY_URL}/api/v1/resource" \\
  -H "X-API-Key: xca_your_key_here"`}
                />
                <CodeBlock
                  language="bash"
                  title="方法 2：Authorization Header"
                  code={`curl "${GATEWAY_URL}/api/v1/resource" \\
  -H "Authorization: ApiKey xca_your_key_here"`}
                />
                <CodeBlock
                  language="bash"
                  title="方法 3：Query Parameter（開發測試用，生產環境不建議）"
                  code={`curl "${GATEWAY_URL}/api/v1/resource?api_key=xca_your_key_here"`}
                />
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
                  <strong>安全提示：</strong>請勿將 API Key 硬編碼在前端程式碼或版本控制中。
                  建議使用環境變數（<code className="font-mono">process.env.API_KEY</code>）管理。
                </div>
              </div>
            </section>

            {/* ── 速率限制 ─────────────────────────────────────── */}
            <section id="ratelimit">
              <SectionTitle icon={Globe} title="速率限制" />
              <div className="space-y-5">
                <p className="text-gray-600">
                  每個 API 訂閱方案都有對應的速率限制（Rate Limit）。超過限制時，Gateway 回傳 <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono">429 Too Many Requests</code>。
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="text-left px-4 py-3 font-semibold text-gray-700 rounded-tl-lg">Response Header</th>
                        <th className="text-left px-4 py-3 font-semibold text-gray-700 rounded-tr-lg">說明</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { header: 'X-RateLimit-Limit',     desc: '每個時間窗口的請求上限' },
                        { header: 'X-RateLimit-Remaining', desc: '目前時間窗口剩餘可用次數' },
                        { header: 'X-RateLimit-Reset',     desc: '下次重置的 UNIX 時間戳（秒）' },
                        { header: 'Retry-After',           desc: '被限流時，建議等待的秒數' },
                      ].map(({ header, desc }, i) => (
                        <tr key={header} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="px-4 py-3 font-mono text-brand-700">{header}</td>
                          <td className="px-4 py-3 text-gray-600">{desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <CodeBlock
                  language="javascript"
                  title="速率限制處理範例"
                  code={`async function callWithRetry(url, options, retries = 3) {
  const res = await fetch(url, options);

  if (res.status === 429 && retries > 0) {
    const wait = parseInt(res.headers.get('Retry-After') || '60') * 1000;
    await new Promise(r => setTimeout(r, wait));
    return callWithRetry(url, options, retries - 1);
  }

  return res;
}`}
                />
              </div>
            </section>

            {/* ── 錯誤碼 ───────────────────────────────────────── */}
            <section id="errors">
              <SectionTitle icon={AlertCircle} title="錯誤碼參考" />
              <div className="space-y-4">
                <p className="text-gray-600">
                  所有錯誤回應採用統一 JSON 格式：
                </p>
                <CodeBlock
                  language="json"
                  title="錯誤回應格式"
                  code={`{
  "error": {
    "code":    "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Retry after 60 seconds.",
    "status":  429
  }
}`}
                />
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="text-left px-4 py-3 font-semibold text-gray-700 rounded-tl-lg w-16">狀態碼</th>
                        <th className="text-left px-4 py-3 font-semibold text-gray-700">error.code</th>
                        <th className="text-left px-4 py-3 font-semibold text-gray-700 rounded-tr-lg">說明</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { status: '400', code: 'BAD_REQUEST',           desc: '請求格式錯誤或缺少必要參數' },
                        { status: '401', code: 'UNAUTHORIZED',          desc: '缺少認證資訊或 Token 無效' },
                        { status: '403', code: 'FORBIDDEN',             desc: '無存取此資源的權限（訂閱未啟用）' },
                        { status: '404', code: 'NOT_FOUND',             desc: '指定資源不存在' },
                        { status: '429', code: 'RATE_LIMIT_EXCEEDED',   desc: '超過速率限制，請等待 Retry-After 秒後重試' },
                        { status: '503', code: 'SERVICE_UNAVAILABLE',   desc: 'Circuit Breaker 開啟，上游服務暫時不可用' },
                      ].map(({ status, code, desc }, i) => (
                        <tr key={status} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="px-4 py-3 font-mono font-semibold text-gray-800">{status}</td>
                          <td className="px-4 py-3 font-mono text-red-600 text-xs">{code}</td>
                          <td className="px-4 py-3 text-gray-600">{desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            {/* ── 程式碼範例 ───────────────────────────────────── */}
            <section id="sdks">
              <SectionTitle icon={Code2} title="程式碼範例" />
              <div className="space-y-5">
                <CodeBlock
                  language="bash"
                  title="cURL"
                  code={`curl -X GET "${GATEWAY_URL}/your-api/v1/resource" \\
  -H "X-API-Key: xca_your_key_here" \\
  -H "Accept: application/json"`}
                />
                <CodeBlock
                  language="javascript"
                  title="JavaScript / Node.js"
                  code={`const API_KEY = process.env.API_KEY;
const BASE_URL = '${GATEWAY_URL}';

async function callAPI(path) {
  const res = await fetch(\`\${BASE_URL}\${path}\`, {
    headers: {
      'X-API-Key': API_KEY,
      'Accept': 'application/json',
    },
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(\`\${res.status}: \${err.error?.message}\`);
  }

  return res.json();
}

const data = await callAPI('/your-api/v1/resource');`}
                />
                <CodeBlock
                  language="bash"
                  title="Python（requests）"
                  code={`import os
import requests

API_KEY = os.environ['API_KEY']
BASE_URL = '${GATEWAY_URL}'

def call_api(path: str) -> dict:
    resp = requests.get(
        f"{BASE_URL}{path}",
        headers={
            "X-API-Key": API_KEY,
            "Accept": "application/json",
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()

data = call_api("/your-api/v1/resource")`}
                />
              </div>
            </section>

            {/* ── CTA ──────────────────────────────────────────── */}
            <div className="bg-gradient-to-r from-brand-600 to-brand-500 rounded-2xl p-8 text-white text-center">
              <h2 className="text-xl font-bold mb-2">準備好整合了嗎？</h2>
              <p className="text-brand-100 mb-6 text-sm">
                瀏覽 API 目錄，訂閱方案並取得 API Key，5 分鐘內完成第一個呼叫。
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <Link
                  href="/apis"
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-brand-700
                             font-semibold rounded-xl hover:bg-brand-50 transition-colors text-sm"
                >
                  瀏覽 API 目錄 <ArrowRight size={14} />
                </Link>
                <Link
                  href="/auth/register"
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-700/60 border
                             border-white/20 text-white font-semibold rounded-xl hover:bg-brand-700/80
                             transition-colors text-sm"
                >
                  免費註冊
                </Link>
              </div>
            </div>

          </article>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────

function SectionTitle({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-5 pb-3 border-b border-gray-200">
      <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
        <Icon size={16} className="text-brand-600" />
      </div>
      <h2 className="text-xl font-bold text-gray-900">{title}</h2>
    </div>
  )
}

function AuthMethodCard({
  title, badge, badgeColor, desc, checks,
}: {
  title:       string
  badge:       string
  badgeColor:  'green' | 'blue'
  desc:        string
  checks:      string[]
}) {
  const badgeClass = badgeColor === 'green'
    ? 'bg-green-100 text-green-700'
    : 'bg-blue-100 text-blue-700'

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badgeClass}`}>{badge}</span>
      </div>
      <p className="text-sm text-gray-500 leading-relaxed mb-4">{desc}</p>
      <ul className="space-y-2">
        {checks.map((c) => (
          <li key={c} className="flex items-center gap-2 text-sm text-gray-600">
            <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
            {c}
          </li>
        ))}
      </ul>
    </div>
  )
}
