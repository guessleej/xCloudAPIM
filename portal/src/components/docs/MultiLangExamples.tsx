'use client'
/**
 * Multi-language code examples generator
 * Generates curl / JavaScript / Python / Go snippets for a given API
 */
import { useState } from 'react'
import { clsx } from 'clsx'
import CodeBlock from './CodeBlock'

type Lang = 'curl' | 'javascript' | 'python' | 'go'

const LANG_META: Record<Lang, { label: string; syntax: string }> = {
  curl:       { label: 'cURL',       syntax: 'bash'       },
  javascript: { label: 'JavaScript', syntax: 'javascript' },
  python:     { label: 'Python',     syntax: 'python'     },
  go:         { label: 'Go',         syntax: 'go'         },
}

interface ExampleConfig {
  baseUrl:     string
  basePath:    string
  authMethod:  'bearer' | 'api_key' | 'none'
  apiKeyHeader: string
  method:      string
  path:        string      // relative path, e.g. "/users"
  bodyJson?:   string
}

function generateCurl(cfg: ExampleConfig): string {
  const url  = `${cfg.baseUrl}${cfg.path}`
  const auth = cfg.authMethod === 'bearer'
    ? '  -H "Authorization: Bearer $TOKEN" \\\n'
    : cfg.authMethod === 'api_key'
    ? `  -H "${cfg.apiKeyHeader}: $API_KEY" \\\n`
    : ''
  const body = cfg.bodyJson
    ? `  -H "Content-Type: application/json" \\\n  -d '${cfg.bodyJson}' \\\n`
    : ''

  return `curl -X ${cfg.method} "${url}" \\
${auth}${body}  -H "Accept: application/json"`
}

function generateJS(cfg: ExampleConfig): string {
  const url    = `${cfg.baseUrl}${cfg.path}`
  const headers: Record<string, string> = { 'Accept': 'application/json' }
  if (cfg.authMethod === 'bearer')  headers['Authorization'] = 'Bearer ' + '${TOKEN}'
  if (cfg.authMethod === 'api_key') headers[cfg.apiKeyHeader] = '${API_KEY}'
  if (cfg.bodyJson) headers['Content-Type'] = 'application/json'

  const headersStr = Object.entries(headers)
    .map(([k, v]) => `    '${k}': '${v}'`)
    .join(',\n')

  const bodyPart = cfg.bodyJson ? `,\n  body: JSON.stringify(${cfg.bodyJson})` : ''

  return `const response = await fetch('${url}', {
  method: '${cfg.method}',
  headers: {
${headersStr}
  }${bodyPart},
});

const data = await response.json();
console.log(data);`
}

function generatePython(cfg: ExampleConfig): string {
  const url  = `${cfg.baseUrl}${cfg.path}`
  const headers: Record<string, string> = { 'Accept': 'application/json' }
  if (cfg.authMethod === 'bearer')  headers['Authorization'] = 'Bearer {TOKEN}'
  if (cfg.authMethod === 'api_key') headers[cfg.apiKeyHeader] = '{API_KEY}'

  const headersStr = Object.entries(headers)
    .map(([k, v]) => `    "${k}": "${v}"`)
    .join(',\n')

  const bodyPart = cfg.bodyJson
    ? `,\n    json=${cfg.bodyJson}`
    : ''

  return `import requests

headers = {
${headersStr}
}

response = requests.${cfg.method.toLowerCase()}(
    "${url}",
    headers=headers${bodyPart}
)

data = response.json()
print(data)`
}

function generateGo(cfg: ExampleConfig): string {
  const url = `${cfg.baseUrl}${cfg.path}`
  const authHeader = cfg.authMethod === 'bearer'
    ? '\treq.Header.Set("Authorization", "Bearer "+token)\n'
    : cfg.authMethod === 'api_key'
    ? `\treq.Header.Set("${cfg.apiKeyHeader}", apiKey)\n`
    : ''
  const bodyPart = cfg.bodyJson
    ? `\tbody := strings.NewReader(\`${cfg.bodyJson}\`)\n`
    : ''
  const bodyArg = cfg.bodyJson ? 'body' : 'nil'

  return `package main

import (
\t"encoding/json"
\t"fmt"
\t"net/http"${cfg.bodyJson ? '\n\t"strings"' : ''}
)

func main() {
${bodyPart}\treq, _ := http.NewRequest("${cfg.method}", "${url}", ${bodyArg})
\treq.Header.Set("Accept", "application/json")
${authHeader}
\tclient := &http.Client{}
\tresp, err := client.Do(req)
\tif err != nil { panic(err) }
\tdefer resp.Body.Close()

\tvar data interface{}
\tjson.NewDecoder(resp.Body).Decode(&data)
\tfmt.Println(data)
}`
}

// ─── Component ────────────────────────────────────────────────

interface Props {
  apiName:   string
  baseUrl:   string
  basePath:  string
  authMethods: string[]   // e.g. ['jwt', 'api_key']
}

export default function MultiLangExamples({ apiName, baseUrl, basePath, authMethods }: Props) {
  const [lang, setLang] = useState<Lang>('curl')

  const authMethod: ExampleConfig['authMethod'] =
    authMethods.includes('jwt') || authMethods.includes('oauth2') ? 'bearer' :
    authMethods.includes('api_key') ? 'api_key' : 'none'

  const cfg: ExampleConfig = {
    baseUrl:      baseUrl,
    basePath:     basePath,
    authMethod,
    apiKeyHeader: 'X-API-Key',
    method:       'GET',
    path:         '/',
  }

  const snippets: Record<Lang, string> = {
    curl:       generateCurl(cfg),
    javascript: generateJS(cfg),
    python:     generatePython(cfg),
    go:         generateGo(cfg),
  }

  return (
    <div>
      {/* Lang tabs */}
      <div className="flex gap-1 mb-3 border border-gray-200 rounded-xl p-1 bg-gray-50 w-fit">
        {(Object.keys(LANG_META) as Lang[]).map((l) => (
          <button
            key={l}
            onClick={() => setLang(l)}
            className={clsx(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              lang === l
                ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
                : 'text-gray-500 hover:text-gray-700',
            )}
          >
            {LANG_META[l].label}
          </button>
        ))}
      </div>

      <CodeBlock
        code={snippets[lang]}
        language={LANG_META[lang].syntax}
        title={`${apiName} — ${LANG_META[lang].label} 範例`}
      />

      {authMethod !== 'none' && (
        <div className="mt-3 text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <span className="font-semibold text-amber-700">注意：</span>
          {authMethod === 'bearer'
            ? ' 請將 $TOKEN 替換為您的 JWT Access Token，可從訂閱頁面取得。'
            : ' 請將 $API_KEY 替換為您的 API Key，可從訂閱頁面建立並複製。'}
        </div>
      )}
    </div>
  )
}
