package domain

import (
	"time"
)

// ─── Plan ─────────────────────────────────────────────────────

type Plan struct {
	ID             string          `db:"id"              json:"id"`
	Name           string          `db:"name"            json:"name"`
	DisplayName    string          `db:"display_name"    json:"display_name"`
	Description    string          `db:"description"     json:"description"`
	RPMLimit       int64           `db:"rpm_limit"       json:"rpm_limit"`
	RPHLimit       *int64          `db:"rph_limit"       json:"rph_limit,omitempty"`
	RPDLimit       int64           `db:"rpd_limit"       json:"rpd_limit"`
	RPMMonth       *int64          `db:"rpm_limit_month" json:"rpm_limit_month,omitempty"`
	BurstMult      float64         `db:"burst_multiplier" json:"burst_multiplier"`
	Features       map[string]any  `db:"-"               json:"features"`
	MaxAPIKeys     int             `db:"max_api_keys"    json:"max_api_keys"`
	MaxApps        int             `db:"max_apps"        json:"max_apps"`
	PriceCents     int             `db:"price_cents"     json:"price_cents"`
	Currency       string          `db:"currency"        json:"currency"`
	IsPublic       bool            `db:"is_public"       json:"is_public"`
	IsActive       bool            `db:"is_active"       json:"is_active"`
	SortOrder      int             `db:"sort_order"      json:"sort_order"`
	CreatedAt      time.Time       `db:"created_at"      json:"created_at"`
	UpdatedAt      time.Time       `db:"updated_at"      json:"updated_at"`
}

// ─── Subscription ─────────────────────────────────────────────

type SubscriptionStatus string

const (
	SubStatusPending   SubscriptionStatus = "pending"
	SubStatusActive    SubscriptionStatus = "active"
	SubStatusSuspended SubscriptionStatus = "suspended"
	SubStatusExpired   SubscriptionStatus = "expired"
	SubStatusCancelled SubscriptionStatus = "cancelled"
)

type Subscription struct {
	ID             string             `db:"id"              json:"id"`
	OrganizationID string             `db:"organization_id" json:"organization_id"`
	APIID          string             `db:"api_id"          json:"api_id"`
	PlanID         string             `db:"plan_id"         json:"plan_id"`
	SubscriberID   string             `db:"subscriber_id"   json:"subscriber_id"`
	Status         SubscriptionStatus `db:"status"          json:"status"`
	StartDate      time.Time          `db:"start_date"      json:"start_date"`
	EndDate        *time.Time         `db:"end_date"        json:"end_date,omitempty"`
	ApprovedBy     *string            `db:"approved_by"     json:"approved_by,omitempty"`
	ApprovedAt     *time.Time         `db:"approved_at"     json:"approved_at,omitempty"`
	RejectedReason *string            `db:"rejected_reason" json:"rejected_reason,omitempty"`
	Notes          string             `db:"notes"           json:"notes"`
	CreatedAt      time.Time          `db:"created_at"      json:"created_at"`
	UpdatedAt      time.Time          `db:"updated_at"      json:"updated_at"`

	// 關聯資料（JOIN 查詢時填入）
	Plan *Plan `db:"-" json:"plan,omitempty"`
}

// ─── API Key ──────────────────────────────────────────────────

type APIKeyStatus string

const (
	KeyStatusActive  APIKeyStatus = "active"
	KeyStatusRevoked APIKeyStatus = "revoked"
	KeyStatusExpired APIKeyStatus = "expired"
)

type APIKey struct {
	ID             string       `db:"id"              json:"id"`
	SubscriptionID string       `db:"subscription_id" json:"subscription_id"`
	OrganizationID string       `db:"organization_id" json:"organization_id"`
	KeyHash        string       `db:"key_hash"        json:"-"`     // 不回傳給前端
	KeyPrefix      string       `db:"key_prefix"      json:"key_prefix"`
	Name           string       `db:"name"            json:"name"`
	Description    string       `db:"description"     json:"description"`
	Status         APIKeyStatus `db:"status"          json:"status"`
	AllowedIPs     []string     `db:"-"               json:"allowed_ips"`
	AllowedOrigins []string     `db:"-"               json:"allowed_origins"`
	Scopes         []string     `db:"-"               json:"scopes"`
	ExpiresAt      *time.Time   `db:"expires_at"      json:"expires_at,omitempty"`
	LastUsedAt     *time.Time   `db:"last_used_at"    json:"last_used_at,omitempty"`
	CreatedBy      string       `db:"created_by"      json:"created_by"`
	RevokedBy      *string      `db:"revoked_by"      json:"revoked_by,omitempty"`
	RevokedAt      *time.Time   `db:"revoked_at"      json:"revoked_at,omitempty"`
	RevokeReason   *string      `db:"revoke_reason"   json:"revoke_reason,omitempty"`
	CreatedAt      time.Time    `db:"created_at"      json:"created_at"`
	UpdatedAt      time.Time    `db:"updated_at"      json:"updated_at"`

	// 建立時才回傳明文 key（不儲存）
	PlainKey string `db:"-" json:"key,omitempty"`
}

// ─── Quota ────────────────────────────────────────────────────

type QuotaUsageDaily struct {
	ID             string     `db:"id"`
	SubscriptionID string     `db:"subscription_id"`
	APIID          string     `db:"api_id"`
	UsageDate      time.Time  `db:"usage_date"`
	RequestCount   int64      `db:"request_count"`
	SuccessCount   int64      `db:"success_count"`
	ErrorCount     int64      `db:"error_count"`
	TotalBytesIn   int64      `db:"total_bytes_in"`
	TotalBytesOut  int64      `db:"total_bytes_out"`
	AvgLatencyMs   *float64   `db:"avg_latency_ms"`
	P95LatencyMs   *float64   `db:"p95_latency_ms"`
	P99LatencyMs   *float64   `db:"p99_latency_ms"`
	CreatedAt      time.Time  `db:"created_at"`
	UpdatedAt      time.Time  `db:"updated_at"`
}

type QuotaUsageMonthly struct {
	ID             string    `db:"id"`
	SubscriptionID string    `db:"subscription_id"`
	APIID          string    `db:"api_id"`
	YearMonth      string    `db:"year_month"`
	RequestCount   int64     `db:"request_count"`
	ErrorCount     int64     `db:"error_count"`
	OverQuotaCount int64     `db:"over_quota_count"`
	UpdatedAt      time.Time `db:"updated_at"`
}

// ─── Quota Check Result ───────────────────────────────────────

type ClientQuota struct {
	ClientID     string `json:"client_id"`
	APIID        string `json:"api_id"`
	RPMLimit     int64  `json:"rpm_limit"`
	DailyLimit   int64  `json:"daily_limit"`
	MonthlyLimit int64  `json:"monthly_limit"`
	Plan         string `json:"plan"`
	// 當前使用量（即時 Redis 計數）
	RPMUsed     int64 `json:"rpm_used"`
	DailyUsed   int64 `json:"daily_used"`
	MonthlyUsed int64 `json:"monthly_used"`
}

type QuotaCheckResult struct {
	Allowed      bool   `json:"allowed"`
	Reason       string `json:"reason,omitempty"`
	RemainingRPM int64  `json:"remaining_rpm"`
	RetryAfter   int64  `json:"retry_after,omitempty"`
}

// ─── Subscription Audit Log ───────────────────────────────────

type SubscriptionAuditLog struct {
	ID             string     `db:"id"              json:"id"`
	SubscriptionID string     `db:"subscription_id" json:"subscription_id"`
	Action         string     `db:"action"          json:"action"`
	OldValue       []byte     `db:"old_value"       json:"old_value,omitempty"`
	NewValue       []byte     `db:"new_value"       json:"new_value,omitempty"`
	PerformedBy    *string    `db:"performed_by"    json:"performed_by,omitempty"`
	PerformedAt    time.Time  `db:"performed_at"    json:"performed_at"`
	IPAddress      *string    `db:"ip_address"      json:"ip_address,omitempty"`
	Reason         *string    `db:"reason"          json:"reason,omitempty"`
}

// ─── Request/Response DTOs ────────────────────────────────────

type CreateSubscriptionReq struct {
	APIID  string `json:"api_id"  binding:"required,uuid"`
	PlanID string `json:"plan_id" binding:"required,uuid"`
	Notes  string `json:"notes"`
}

type ApproveSubscriptionReq struct {
	Notes string `json:"notes"`
}

type SuspendSubscriptionReq struct {
	Reason string `json:"reason" binding:"required"`
}

type ChangePlanReq struct {
	PlanID string `json:"plan_id" binding:"required,uuid"`
	Notes  string `json:"notes"`
}

type CreateAPIKeyReq struct {
	Name           string   `json:"name"            binding:"required,min=1,max=100"`
	Description    string   `json:"description"`
	AllowedIPs     []string `json:"allowed_ips"`
	AllowedOrigins []string `json:"allowed_origins"`
	Scopes         []string `json:"scopes"`
	ExpiresAt      *string  `json:"expires_at"` // RFC3339
}

type RevokeAPIKeyReq struct {
	Reason string `json:"reason" binding:"required"`
}

type ListSubscriptionsQuery struct {
	Status string `form:"status"`
	APIID  string `form:"api_id"`
	Page   int    `form:"page,default=1"`
	Size   int    `form:"size,default=20"`
}

type UsageHistoryQuery struct {
	From string `form:"from" binding:"required"` // YYYY-MM-DD
	To   string `form:"to"   binding:"required"`
}
