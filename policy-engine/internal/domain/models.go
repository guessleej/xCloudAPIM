package domain

import "strings"

// ─── Enums ────────────────────────────────────────────────────

type PolicyType string

const (
	PolicyTypeJWTAuth           PolicyType = "jwt_auth"
	PolicyTypeAPIKeyAuth        PolicyType = "api_key_auth"
	PolicyTypeOAuth2Scope       PolicyType = "oauth2_scope"
	PolicyTypeRateLimit         PolicyType = "rate_limit"
	PolicyTypeCORS              PolicyType = "cors"
	PolicyTypeRequestTransform  PolicyType = "request_transform"
	PolicyTypeResponseTransform PolicyType = "response_transform"
	PolicyTypeIPWhitelist       PolicyType = "ip_whitelist"
	PolicyTypeIPBlacklist       PolicyType = "ip_blacklist"
	PolicyTypeCache             PolicyType = "cache"
	PolicyTypeCircuitBreaker    PolicyType = "circuit_breaker"
	PolicyTypeEncrypt           PolicyType = "encrypt"
	PolicyTypeLogging           PolicyType = "logging"
	PolicyTypeCustom            PolicyType = "custom"
)

type PolicyPhase string

const (
	PhasePreRequest   PolicyPhase = "pre_request"
	PhasePostRequest  PolicyPhase = "post_request"
	PhasePreResponse  PolicyPhase = "pre_response"
	PhasePostResponse PolicyPhase = "post_response"
)

// PhaseOrder is used by executor to sort policies across phases.
var PhaseOrder = map[PolicyPhase]int{
	PhasePreRequest:   0,
	PhasePostRequest:  1,
	PhasePreResponse:  2,
	PhasePostResponse: 3,
}

// ─── Policy Domain Models ─────────────────────────────────────

// PolicyChain is the runtime representation stored and consumed by the engine.
// All IDs are plain strings (UUID format) for JSON serialisation simplicity.
type PolicyChain struct {
	ID       string      `json:"id"`
	APIID    string      `json:"api_id"`
	Version  int64       `json:"version"`
	ETag     string      `json:"etag"`
	Policies []*Policy   `json:"policies"`
}

type Policy struct {
	ID        string            `json:"id"`
	Type      PolicyType        `json:"type"`
	Phase     PolicyPhase       `json:"phase"`
	Order     int               `json:"order"`
	Enabled   bool              `json:"enabled"`
	Config    map[string]string `json:"config"`
	Condition string            `json:"condition,omitempty"`
}

// ─── Execution Context ────────────────────────────────────────

// ExecContext carries the mutable state of a single request through the plugin pipeline.
type ExecContext struct {
	// Identity
	APIID    string
	ClientID string
	Plan     string
	TraceID  string

	// Request (mutable by transform plugins)
	Method         string
	Path           string
	RemoteIP       string
	RequestHeaders map[string]string
	QueryParams    map[string]string
	RequestBody    []byte

	// Response (set after upstream call)
	StatusCode      int
	ResponseBody    []byte
	CachedBody      []byte
	ResponseHeaders map[string]string

	// Cache
	CacheHit bool

	// Abort signal
	Aborted   bool
	AbortCode int
	AbortMsg  string

	// JWT / auth claims
	Claims map[string]interface{}
}

func NewExecContext(apiID, method, path, remoteIP string, headers map[string]string, query map[string]string, body []byte) *ExecContext {
	h := make(map[string]string, len(headers))
	for k, v := range headers {
		h[strings.ToLower(k)] = v
	}
	return &ExecContext{
		APIID:           apiID,
		Method:          method,
		Path:            path,
		RemoteIP:        remoteIP,
		RequestHeaders:  h,
		QueryParams:     query,
		RequestBody:     body,
		ResponseHeaders: make(map[string]string),
		Claims:          make(map[string]interface{}),
	}
}

func (e *ExecContext) Abort(code int, msg string) {
	e.Aborted = true
	e.AbortCode = code
	e.AbortMsg = msg
}

func (e *ExecContext) GetHeader(key string) string {
	if e.RequestHeaders == nil {
		return ""
	}
	return e.RequestHeaders[strings.ToLower(key)]
}

func (e *ExecContext) SetRequestHeader(key, value string) {
	if e.RequestHeaders == nil {
		e.RequestHeaders = make(map[string]string)
	}
	e.RequestHeaders[strings.ToLower(key)] = value
}

func (e *ExecContext) SetResponseHeader(key, value string) {
	if e.ResponseHeaders == nil {
		e.ResponseHeaders = make(map[string]string)
	}
	e.ResponseHeaders[strings.ToLower(key)] = value
}

// ─── Management DTOs (HTTP API) ───────────────────────────────

type CreateChainRequest struct {
	Name        string `json:"name"    binding:"required,min=2,max=100"`
	Description string `json:"description"`
	APIID       string `json:"api_id"`
}

type UpdateChainRequest struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
}

type PublishChainRequest struct {
	ChangeSummary string `json:"change_summary"`
}

type CreatePolicyRequest struct {
	Type      PolicyType        `json:"type"      binding:"required"`
	Phase     PolicyPhase       `json:"phase"     binding:"required"`
	Order     int               `json:"order"`
	Name      string            `json:"name"      binding:"required,min=2,max=100"`
	Enabled   *bool             `json:"enabled"`
	Config    map[string]string `json:"config"`
	Condition string            `json:"condition"`
}

type UpdatePolicyRequest struct {
	Type      *PolicyType        `json:"type"`
	Phase     *PolicyPhase       `json:"phase"`
	Order     *int               `json:"order"`
	Name      *string            `json:"name"`
	Enabled   *bool              `json:"enabled"`
	Config    map[string]string  `json:"config"`
	Condition *string            `json:"condition"`
}

type InvalidateCacheRequest struct {
	APIID  string `json:"api_id"  binding:"required"`
	Reason string `json:"reason"`
}

// ─── CB State (used by circuit_breaker plugin) ────────────────

type CBState string

const (
	CBStateClosed   CBState = "closed"
	CBStateOpen     CBState = "open"
	CBStateHalfOpen CBState = "half_open"
)
