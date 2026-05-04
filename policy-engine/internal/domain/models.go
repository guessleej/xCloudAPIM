package domain

import "time"

// ─── Policy Chain ─────────────────────────────────────────────
type PolicyChain struct {
	ID       string
	APIID    string
	Version  int64
	ETag     string
	Policies []*Policy
}

type Policy struct {
	ID        string
	Type      PolicyType
	Phase     PolicyPhase
	Order     int
	Enabled   bool
	Config    map[string]string
	Condition string // 可選執行條件表達式
}

type PolicyType string

const (
	PolicyTypeJWTAuth           PolicyType = "jwt_auth"
	PolicyTypeAPIKeyAuth        PolicyType = "api_key_auth"
	PolicyTypeRateLimit         PolicyType = "rate_limit"
	PolicyTypeCORS              PolicyType = "cors"
	PolicyTypeRequestTransform  PolicyType = "request_transform"
	PolicyTypeResponseTransform PolicyType = "response_transform"
	PolicyTypeIPWhitelist       PolicyType = "ip_whitelist"
	PolicyTypeCache             PolicyType = "cache"
	PolicyTypeEncrypt           PolicyType = "encrypt"
	PolicyTypeCircuitBreaker    PolicyType = "circuit_breaker"
	PolicyTypeLogging           PolicyType = "logging"
)

type PolicyPhase string

const (
	PhasePreRequest   PolicyPhase = "pre_request"
	PhasePostRequest  PolicyPhase = "post_request"
	PhasePreResponse  PolicyPhase = "pre_response"
	PhasePostResponse PolicyPhase = "post_response"
)

// PhaseOrder 定義各 Phase 的執行優先序
var PhaseOrder = map[PolicyPhase]int{
	PhasePreRequest:   0,
	PhasePostRequest:  1,
	PhasePreResponse:  2,
	PhasePostResponse: 3,
}

// ─── Execution Context ────────────────────────────────────────

// ExecContext 貫穿整個 Policy Chain 執行流程的可變上下文
type ExecContext struct {
	// 識別資訊
	TraceID  string
	APIID    string
	ClientID string
	Plan     string

	// 請求資訊（Plugin 可讀寫）
	Method     string
	Path       string
	Host       string
	RemoteIP   string
	RequestHeaders  map[string]string
	RequestBody     []byte
	QueryParams     map[string]string

	// 回應資訊（Phase post_request 之後才有值）
	StatusCode      int
	ResponseHeaders map[string]string
	ResponseBody    []byte

	// 快取命中旗標（Cache Plugin 設定，跳過上游呼叫）
	CacheHit    bool
	CachedBody  []byte

	// 中止旗標（任一 Plugin 設定後終止後續 Plugin）
	Aborted    bool
	AbortCode  int
	AbortMsg   string

	// 額外 claims（JWT Auth Plugin 解析後注入）
	Claims map[string]interface{}

	// 計時
	StartedAt time.Time
}

func NewExecContext(apiID, traceID, method, path, host, remoteIP string) *ExecContext {
	return &ExecContext{
		TraceID:         traceID,
		APIID:           apiID,
		Method:          method,
		Path:            path,
		Host:            host,
		RemoteIP:        remoteIP,
		RequestHeaders:  make(map[string]string),
		ResponseHeaders: make(map[string]string),
		QueryParams:     make(map[string]string),
		Claims:          make(map[string]interface{}),
		StartedAt:       time.Now(),
	}
}

func (ctx *ExecContext) Abort(code int, msg string) {
	ctx.Aborted = true
	ctx.AbortCode = code
	ctx.AbortMsg = msg
}

func (ctx *ExecContext) GetHeader(key string) string {
	return ctx.RequestHeaders[key]
}

func (ctx *ExecContext) SetRequestHeader(key, value string) {
	ctx.RequestHeaders[key] = value
}

func (ctx *ExecContext) SetResponseHeader(key, value string) {
	ctx.ResponseHeaders[key] = value
}

// ─── Plugin 結果 ──────────────────────────────────────────────
type PluginResult struct {
	Skipped bool   // 條件不符，跳過
	Cached  bool   // Cache Plugin 命中
	Aborted bool   // 攔截請求
	Error   error
}

// ─── Circuit Breaker State ────────────────────────────────────
type CBState string

const (
	CBStateClosed   CBState = "closed"
	CBStateOpen     CBState = "open"
	CBStateHalfOpen CBState = "half_open"
)
