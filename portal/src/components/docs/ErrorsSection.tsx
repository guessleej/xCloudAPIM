import CodeBlock from './CodeBlock'

const HTTP_ERRORS = [
  { code: 400, name: 'Bad Request',           desc: '請求格式錯誤或缺少必填欄位',             example: '{"error":"INVALID_PARAMS","message":"field \\"email\\" is required"}' },
  { code: 401, name: 'Unauthorized',           desc: '未提供認證憑證或憑證無效',               example: '{"error":"UNAUTHORIZED","message":"Bearer token is invalid or expired"}' },
  { code: 403, name: 'Forbidden',             desc: '已驗證但無存取此資源的權限',             example: '{"error":"FORBIDDEN","message":"insufficient scopes: required write:data"}' },
  { code: 404, name: 'Not Found',             desc: '請求的資源不存在',                       example: '{"error":"NOT_FOUND","message":"resource /users/999 not found"}' },
  { code: 409, name: 'Conflict',              desc: '請求與目前資源狀態衝突（如重複建立）',   example: '{"error":"CONFLICT","message":"email already exists"}' },
  { code: 422, name: 'Unprocessable Entity',  desc: '欄位格式正確但業務邏輯驗證失敗',         example: '{"error":"VALIDATION_ERROR","message":"quota exceeded for plan Free"}' },
  { code: 429, name: 'Too Many Requests',     desc: '超過速率限制（RPM / RPH / RPD）',         example: '{"error":"RATE_LIMIT_EXCEEDED","message":"limit 1000 rpm exceeded","retryAfter":60}' },
  { code: 500, name: 'Internal Server Error', desc: '伺服器端未預期錯誤',                     example: '{"error":"INTERNAL_ERROR","message":"unexpected error","requestId":"req_abc123"}' },
  { code: 502, name: 'Bad Gateway',           desc: '上游服務無回應或回應無效',               example: '{"error":"BAD_GATEWAY","message":"upstream connection refused"}' },
  { code: 503, name: 'Service Unavailable',   desc: '熔斷器開啟或服務暫時不可用',             example: '{"error":"CIRCUIT_OPEN","message":"circuit breaker is OPEN, retry after 30s"}' },
]

const codeColor: Record<number, string> = {
  4: 'text-amber-600 bg-amber-50',
  5: 'text-red-600 bg-red-50',
}

const STANDARD_RESPONSE = `{
  "error":     "ERROR_CODE",
  "message":   "Human-readable description",
  "requestId": "req_xxxxxxxxxxxx",
  "timestamp": "2024-01-15T10:30:00Z",
  "path":      "/your/endpoint",
  "details":   {}
}`

const RETRY_HEADERS = `# 速率限制相關 Headers
X-RateLimit-Limit:     1000     # 配額上限 (RPM)
X-RateLimit-Remaining: 42       # 剩餘次數
X-RateLimit-Reset:     1705312260  # Unix 時間戳，重置時間
Retry-After:           60       # 建議重試等待秒數（429 時出現）`

export default function ErrorsSection() {
  return (
    <div className="space-y-8">
      {/* Standard error schema */}
      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-3">標準錯誤格式</h2>
        <p className="text-sm text-gray-600 mb-4">
          所有錯誤回應均遵循以下 JSON 結構：
        </p>
        <CodeBlock language="json" code={STANDARD_RESPONSE} />
      </section>

      {/* Error code table */}
      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-4">HTTP 錯誤碼參考</h2>
        <div className="overflow-hidden rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['狀態碼', '名稱', '說明'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {HTTP_ERRORS.map(({ code, name, desc }) => {
                const colorKey = Math.floor(code / 100)
                const colorCls = codeColor[colorKey] ?? 'text-gray-600 bg-gray-50'
                return (
                  <tr key={code} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <span className={`font-mono font-bold text-sm px-2 py-0.5 rounded ${colorCls}`}>
                        {code}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-700">{name}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs leading-relaxed">{desc}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Example error responses */}
      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-4">錯誤範例</h2>
        <div className="space-y-4">
          {HTTP_ERRORS.filter((e) => [401, 429, 503].includes(e.code)).map(({ code, name, example }) => (
            <div key={code}>
              <p className="text-sm font-medium text-gray-700 mb-2">
                <span className={`font-mono font-bold mr-2 ${code >= 500 ? 'text-red-600' : 'text-amber-600'}`}>
                  {code}
                </span>
                {name}
              </p>
              <CodeBlock language="json" code={JSON.stringify(JSON.parse(example), null, 2)} />
            </div>
          ))}
        </div>
      </section>

      {/* Rate limit headers */}
      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-3">速率限制標頭</h2>
        <p className="text-sm text-gray-600 mb-3">
          每個回應都會附帶以下速率限制資訊標頭，方便您在應用端做流量控制：
        </p>
        <CodeBlock language="bash" code={RETRY_HEADERS} />
      </section>
    </div>
  )
}
