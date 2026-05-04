/**
 * 右側 ConfigPanel — 顯示選中 policy 的設定表單
 */
import { X, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useStudioStore, selectSelectedPolicy } from '../../stores/studio.ts'
import { PLUGIN_REGISTRY } from '../../types/policy.ts'
import Button from '../ui/Button.tsx'
import Toggle from '../ui/Toggle.tsx'
import PluginIcon from './library/PluginIcon.tsx'

export default function ConfigPanel() {
  const selectedPolicy = useStudioStore(selectSelectedPolicy)
  const { updatePolicy, selectPolicy, removePolicy, movePolicy } = useStudioStore()
  const [showCondition, setShowCondition] = useState(false)

  if (!selectedPolicy) {
    return (
      <aside className="w-72 border-l border-gray-200 bg-white flex items-center justify-center p-6">
        <div className="text-center">
          <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
            <AlertCircle size={18} className="text-gray-400" />
          </div>
          <p className="text-sm text-gray-500">點選 Policy 節點以編輯設定</p>
        </div>
      </aside>
    )
  }

  const meta = PLUGIN_REGISTRY.find((p) => p.type === selectedPolicy.type)
  if (!meta) return null

  const cfg = selectedPolicy.config

  const setConfig = (key: string, value: string) => {
    updatePolicy(selectedPolicy.id, { config: { [key]: value } })
  }

  return (
    <aside className="w-72 border-l border-gray-200 bg-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${meta.color}`}>
            <PluginIcon name={meta.lucideIcon} size={16} className={meta.textColor} />
          </span>
          <div>
            <h3 className="font-semibold text-sm text-gray-900">{meta.label}</h3>
            <p className="text-xs text-gray-400">{selectedPolicy.phase.replace('_', ' ')}</p>
          </div>
        </div>
        <button onClick={() => selectPolicy(null)} className="text-gray-400 hover:text-gray-600 rounded p-1">
          <X size={16} />
        </button>
      </div>

      {/* Enabled toggle */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="text-sm text-gray-700">啟用</span>
        <Toggle
          checked={selectedPolicy.enabled}
          onChange={(v) => updatePolicy(selectedPolicy.id, { enabled: v })}
        />
      </div>

      {/* Config fields */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <ConfigFields
          type={selectedPolicy.type}
          config={cfg}
          setConfig={setConfig}
        />

        {/* Phase selector */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">執行階段</label>
          <select
            value={selectedPolicy.phase}
            onChange={(e) => movePolicy(selectedPolicy.id, e.target.value as import('../../types/policy.ts').PolicyPhase)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="PRE_REQUEST">Pre-Request</option>
            <option value="POST_REQUEST">Post-Request</option>
            <option value="PRE_RESPONSE">Pre-Response</option>
            <option value="POST_RESPONSE">Post-Response</option>
          </select>
        </div>

        {/* Condition */}
        <div>
          <button
            className="flex items-center gap-1 text-xs font-medium text-gray-500 mb-1"
            onClick={() => setShowCondition(!showCondition)}
          >
            {showCondition ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            執行條件（可選）
          </button>
          {showCondition && (
            <div>
              <input
                type="text"
                placeholder="例：plan=enterprise"
                value={selectedPolicy.condition ?? ''}
                onChange={(e) => updatePolicy(selectedPolicy.id, { condition: e.target.value })}
                className="w-full text-xs font-mono border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-400 mt-1">
                格式：plan=premium、header.X-Env=prod、method=POST
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-100">
        <Button
          variant="danger"
          size="sm"
          className="w-full"
          onClick={() => removePolicy(selectedPolicy.id)}
        >
          移除此 Policy
        </Button>
      </div>
    </aside>
  )
}

// ─── Per-type config fields ────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  )
}

function TextInput({ value, onChange, placeholder, mono }: {
  value: string; onChange: (v: string) => void
  placeholder?: string; mono?: boolean
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 ${mono ? 'font-mono text-xs' : ''}`}
    />
  )
}

function Select({ value, onChange, options }: {
  value: string; onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function ConfigFields({
  type, config, setConfig,
}: {
  type: import('../../types/policy.ts').PolicyType
  config: Record<string, string>
  setConfig: (k: string, v: string) => void
}) {
  const c = (k: string) => config[k] ?? ''
  const s = setConfig

  switch (type) {
    case 'auth':
      return (
        <>
          <Field label="驗證方法（逗號分隔）">
            <TextInput value={c('methods')} onChange={(v) => s('methods', v)} placeholder="jwt,api_key" />
          </Field>
          <Field label="JWT Algorithm">
            <Select value={c('jwt.algorithm') || 'RS256'} onChange={(v) => s('jwt.algorithm', v)}
              options={[
                { value: 'RS256', label: 'RS256 (非對稱)' },
                { value: 'HS256', label: 'HS256 (對稱)' },
                { value: 'ES256', label: 'ES256 (橢圓曲線)' },
              ]} />
          </Field>
          <Field label="JWKS URL">
            <TextInput value={c('jwt.jwks_url')} onChange={(v) => s('jwt.jwks_url', v)} placeholder="https://..." mono />
          </Field>
          <Field label="Required Scopes">
            <TextInput value={c('jwt.required_scopes')} onChange={(v) => s('jwt.required_scopes', v)} placeholder="read:api write:api" />
          </Field>
          <Field label="API Key 位置">
            <Select value={c('api_key.key_location') || 'header,query'} onChange={(v) => s('api_key.key_location', v)}
              options={[
                { value: 'header,query', label: 'Header + Query' },
                { value: 'header', label: 'Header only' },
                { value: 'query', label: 'Query only' },
              ]} />
          </Field>
        </>
      )

    case 'rate_limit':
      return (
        <>
          <Field label="策略">
            <Select value={c('strategy') || 'sliding_window'} onChange={(v) => s('strategy', v)}
              options={[
                { value: 'sliding_window', label: 'Sliding Window' },
                { value: 'fixed_window',   label: 'Fixed Window' },
                { value: 'token_bucket',   label: 'Token Bucket' },
              ]} />
          </Field>
          <Field label="識別方式">
            <Select value={c('key_by') || 'client_id'} onChange={(v) => s('key_by', v)}
              options={[
                { value: 'client_id', label: 'Client ID' },
                { value: 'ip',        label: 'IP Address' },
                { value: 'user_id',   label: 'User ID' },
                { value: 'api_key',   label: 'API Key' },
              ]} />
          </Field>
          <Field label="RPM（每分鐘請求數）">
            <TextInput value={c('rpm')} onChange={(v) => s('rpm', v)} placeholder="1000" />
          </Field>
          <Field label="RPH（每小時請求數）">
            <TextInput value={c('rph')} onChange={(v) => s('rph', v)} placeholder="10000" />
          </Field>
          <Field label="RPD（每天請求數）">
            <TextInput value={c('rpd')} onChange={(v) => s('rpd', v)} placeholder="100000" />
          </Field>
        </>
      )

    case 'cors':
      return (
        <>
          <Field label="允許 Origins">
            <TextInput value={c('allowed_origins')} onChange={(v) => s('allowed_origins', v)} placeholder="*" />
          </Field>
          <Field label="允許 Methods">
            <TextInput value={c('allowed_methods')} onChange={(v) => s('allowed_methods', v)} placeholder="GET,POST,PUT,DELETE,OPTIONS" />
          </Field>
          <Field label="允許 Headers">
            <TextInput value={c('allowed_headers')} onChange={(v) => s('allowed_headers', v)} placeholder="Content-Type,Authorization" />
          </Field>
          <Field label="Allow Credentials">
            <Select value={c('allow_credentials') || 'false'} onChange={(v) => s('allow_credentials', v)}
              options={[{ value: 'false', label: '不允許' }, { value: 'true', label: '允許' }]} />
          </Field>
          <Field label="Max Age (秒)">
            <TextInput value={c('max_age')} onChange={(v) => s('max_age', v)} placeholder="3600" />
          </Field>
        </>
      )

    case 'ip_whitelist':
      return (
        <>
          <Field label="模式">
            <Select value={c('mode') || 'whitelist'} onChange={(v) => s('mode', v)}
              options={[{ value: 'whitelist', label: '白名單' }, { value: 'blacklist', label: '黑名單' }]} />
          </Field>
          <Field label="IP 列表（逗號分隔，支援 CIDR）">
            <textarea
              value={c('ips')} onChange={(e) => s('ips', e.target.value)}
              placeholder="192.168.1.0/24, 10.0.0.1"
              rows={3}
              className="w-full text-xs font-mono border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </Field>
        </>
      )

    case 'transform':
      return (
        <>
          <Field label="注入 Request-ID">
            <Select value={c('inject_request_id') || 'true'} onChange={(v) => s('inject_request_id', v)}
              options={[{ value: 'true', label: '是' }, { value: 'false', label: '否' }]} />
          </Field>
          <Field label="注入 Gateway 標頭">
            <Select value={c('inject_gateway_id') || 'true'} onChange={(v) => s('inject_gateway_id', v)}
              options={[{ value: 'true', label: '是' }, { value: 'false', label: '否' }]} />
          </Field>
          <Field label="Request Headers（JSON array）">
            <textarea
              value={c('request_headers')} onChange={(e) => s('request_headers', e.target.value)}
              placeholder={'[{"op":"set","name":"X-Client","value":"${ctx.clientId}"}]'}
              rows={3}
              className="w-full text-xs font-mono border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </Field>
          <Field label="Response Headers（JSON array）">
            <textarea
              value={c('response_headers')} onChange={(e) => s('response_headers', e.target.value)}
              placeholder={'[{"op":"remove","name":"X-Powered-By"}]'}
              rows={3}
              className="w-full text-xs font-mono border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </Field>
          <Field label="Response Body Ops（JSON array）">
            <textarea
              value={c('response_body_ops')} onChange={(e) => s('response_body_ops', e.target.value)}
              placeholder={'[{"op":"wrap","key":"data"}]'}
              rows={3}
              className="w-full text-xs font-mono border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </Field>
        </>
      )

    case 'cache':
      return (
        <>
          <Field label="TTL（秒）">
            <TextInput value={c('ttl')} onChange={(v) => s('ttl', v)} placeholder="60" />
          </Field>
          <Field label="Cache Key">
            <Select value={c('key_by') || 'path'} onChange={(v) => s('key_by', v)}
              options={[
                { value: 'path',              label: 'Path only' },
                { value: 'path_method',       label: 'Path + Method' },
                { value: 'path_method_client', label: 'Path + Method + Client' },
              ]} />
          </Field>
          <Field label="Bypass Condition">
            <Select value={c('bypass_if') || ''} onChange={(v) => s('bypass_if', v)}
              options={[
                { value: '',         label: '不 Bypass' },
                { value: 'no-cache', label: 'Cache-Control: no-cache' },
              ]} />
          </Field>
          <Field label="Vary Headers">
            <TextInput value={c('vary_headers')} onChange={(v) => s('vary_headers', v)} placeholder="Accept-Language" />
          </Field>
        </>
      )

    case 'circuit_breaker':
      return (
        <>
          <Field label="失敗閾值（次數）">
            <TextInput value={c('threshold')} onChange={(v) => s('threshold', v)} placeholder="5" />
          </Field>
          <Field label="錯誤率閾值（%）">
            <TextInput value={c('error_threshold')} onChange={(v) => s('error_threshold', v)} placeholder="50" />
          </Field>
          <Field label="Open → Half-Open 超時（秒）">
            <TextInput value={c('timeout')} onChange={(v) => s('timeout', v)} placeholder="30" />
          </Field>
          <Field label="統計視窗（秒）">
            <TextInput value={c('window')} onChange={(v) => s('window', v)} placeholder="60" />
          </Field>
          <Field label="Half-Open 最大探測數">
            <TextInput value={c('half_open_max')} onChange={(v) => s('half_open_max', v)} placeholder="2" />
          </Field>
        </>
      )

    default:
      return null
  }
}
