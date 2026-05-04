package domain

import (
	"time"

	"github.com/google/uuid"
)

// ─── API ─────────────────────────────────────────────────────
type API struct {
	ID             uuid.UUID  `json:"id"              db:"id"`
	OrganizationID uuid.UUID  `json:"organization_id" db:"organization_id"`
	Name           string     `json:"name"            db:"name"`
	Slug           string     `json:"slug"            db:"slug"`
	Description    string     `json:"description"     db:"description"`
	Category       string     `json:"category"        db:"category"`
	Tags           []string   `json:"tags"            db:"tags"`
	Status         APIStatus  `json:"status"          db:"status"`
	IsPublic       bool       `json:"is_public"       db:"is_public"`
	OwnerID        uuid.UUID  `json:"owner_id"        db:"owner_id"`
	ThumbnailURL   string     `json:"thumbnail_url"   db:"thumbnail_url"`
	DocumentationURL string   `json:"documentation_url" db:"documentation_url"`
	Metadata       JSONMap    `json:"metadata"        db:"metadata"`
	CreatedAt      time.Time  `json:"created_at"      db:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"      db:"updated_at"`
	// 關聯（join 查詢時填入）
	LatestVersion  *APIVersion `json:"latest_version,omitempty" db:"-"`
	VersionCount   int         `json:"version_count,omitempty"  db:"version_count"`
}

type APIStatus string

const (
	APIStatusDraft      APIStatus = "draft"
	APIStatusPublished  APIStatus = "published"
	APIStatusDeprecated APIStatus = "deprecated"
	APIStatusArchived   APIStatus = "archived"
)

// ─── API Version ──────────────────────────────────────────────
type APIVersion struct {
	ID              uuid.UUID         `json:"id"               db:"id"`
	APIID           uuid.UUID         `json:"api_id"           db:"api_id"`
	Version         string            `json:"version"          db:"version"`
	Status          VersionStatus     `json:"status"           db:"status"`
	SpecFormat      string            `json:"spec_format"      db:"spec_format"`
	SpecContent     string            `json:"spec_content,omitempty" db:"spec_content"`
	SpecVersion     string            `json:"spec_version"     db:"spec_version"`
	BackendProtocol string            `json:"backend_protocol" db:"backend_protocol"`
	UpstreamURL     string            `json:"upstream_url"     db:"upstream_url"`
	StripPrefix     string            `json:"strip_prefix"     db:"strip_prefix"`
	BasePath        string            `json:"base_path"        db:"base_path"`
	TimeoutMS       int               `json:"timeout_ms"       db:"timeout_ms"`
	RetryCount      int               `json:"retry_count"      db:"retry_count"`
	RetryDelayMS    int               `json:"retry_delay_ms"   db:"retry_delay_ms"`
	Changelog       string            `json:"changelog"        db:"changelog"`
	PublishedAt     *time.Time        `json:"published_at"     db:"published_at"`
	DeprecatedAt    *time.Time        `json:"deprecated_at"    db:"deprecated_at"`
	SunsetDate      *time.Time        `json:"sunset_date"      db:"sunset_date"`
	CreatedBy       uuid.UUID         `json:"created_by"       db:"created_by"`
	CreatedAt       time.Time         `json:"created_at"       db:"created_at"`
	UpdatedAt       time.Time         `json:"updated_at"       db:"updated_at"`
	// 解析後的 Spec 摘要
	SpecSummary     *SpecSummary      `json:"spec_summary,omitempty" db:"-"`
}

type VersionStatus string

const (
	VersionStatusDraft      VersionStatus = "draft"
	VersionStatusActive     VersionStatus = "active"
	VersionStatusDeprecated VersionStatus = "deprecated"
	VersionStatusRetired    VersionStatus = "retired"
)

// ─── OpenAPI Spec 摘要 ────────────────────────────────────────
type SpecSummary struct {
	Title       string          `json:"title"`
	Description string          `json:"description"`
	Version     string          `json:"version"`
	Servers     []SpecServer    `json:"servers,omitempty"`
	Endpoints   []SpecEndpoint  `json:"endpoints"`
	TagList     []string        `json:"tags,omitempty"`
	PathCount   int             `json:"path_count"`
}

type SpecServer struct {
	URL         string `json:"url"`
	Description string `json:"description,omitempty"`
}

type SpecEndpoint struct {
	Path        string   `json:"path"`
	Method      string   `json:"method"`
	Summary     string   `json:"summary,omitempty"`
	Description string   `json:"description,omitempty"`
	Tags        []string `json:"tags,omitempty"`
	Deprecated  bool     `json:"deprecated,omitempty"`
}

// ─── Gateway Route ────────────────────────────────────────────
type GatewayRoute struct {
	ID            uuid.UUID  `json:"id"             db:"id"`
	APIID         uuid.UUID  `json:"api_id"         db:"api_id"`
	APIVersionID  uuid.UUID  `json:"api_version_id" db:"api_version_id"`
	APIName       string     `json:"api_name"       db:"api_name"`
	APIVersion    string     `json:"api_version"    db:"api_version"`
	HostMatch     string     `json:"host_match"     db:"host_match"`
	PathPrefix    string     `json:"path_prefix"    db:"path_prefix"`
	Methods       []string   `json:"methods"        db:"methods"`
	UpstreamURL   string     `json:"upstream_url"   db:"upstream_url"`
	StripPrefix   string     `json:"strip_prefix"   db:"strip_prefix"`
	PolicyChainID *uuid.UUID `json:"policy_chain_id" db:"policy_chain_id"`
	Active        bool       `json:"active"         db:"active"`
	Priority      int        `json:"priority"       db:"priority"`
	UpdatedAt     time.Time  `json:"updated_at"     db:"updated_at"`
}

// ─── Request / Response DTOs ──────────────────────────────────

type CreateAPIRequest struct {
	Name             string  `json:"name"              binding:"required,min=2,max=100"`
	Slug             string  `json:"slug"              binding:"omitempty,min=2,max=100"`
	Description      string  `json:"description"`
	Category         string  `json:"category"`
	Tags             []string `json:"tags"`
	IsPublic         bool    `json:"is_public"`
	ThumbnailURL     string  `json:"thumbnail_url"`
	DocumentationURL string  `json:"documentation_url"`
}

type UpdateAPIRequest struct {
	Name             *string   `json:"name"`
	Description      *string   `json:"description"`
	Category         *string   `json:"category"`
	Tags             []string  `json:"tags"`
	IsPublic         *bool     `json:"is_public"`
	ThumbnailURL     *string   `json:"thumbnail_url"`
	DocumentationURL *string   `json:"documentation_url"`
	Status           *APIStatus `json:"status"`
}

type CreateVersionRequest struct {
	Version         string `json:"version"          binding:"required"`
	BackendProtocol string `json:"backend_protocol" binding:"required,oneof=http https grpc ws wss"`
	UpstreamURL     string `json:"upstream_url"     binding:"required,url"`
	StripPrefix     string `json:"strip_prefix"`
	BasePath        string `json:"base_path"`
	TimeoutMS       int    `json:"timeout_ms"`
	RetryCount      int    `json:"retry_count"`
	RetryDelayMS    int    `json:"retry_delay_ms"`
	Changelog       string `json:"changelog"`
	SpecFormat      string `json:"spec_format"      binding:"omitempty,oneof=yaml json"`
	SpecContent     string `json:"spec_content"`
}

type UpdateVersionRequest struct {
	BackendProtocol *string `json:"backend_protocol"`
	UpstreamURL     *string `json:"upstream_url"`
	StripPrefix     *string `json:"strip_prefix"`
	BasePath        *string `json:"base_path"`
	TimeoutMS       *int    `json:"timeout_ms"`
	RetryCount      *int    `json:"retry_count"`
	Changelog       *string `json:"changelog"`
}

type UploadSpecRequest struct {
	Format  string `json:"format"  binding:"required,oneof=yaml json"`
	Content string `json:"content" binding:"required"`
}

type PublishVersionRequest struct {
	PathPrefix  string `json:"path_prefix"  binding:"required"`
	HostMatch   string `json:"host_match"`
	Priority    int    `json:"priority"`
}

type APIListParams struct {
	Page     int       `form:"page,default=1"`
	PageSize int       `form:"page_size,default=20"`
	Status   APIStatus `form:"status"`
	Category string    `form:"category"`
	Tag      string    `form:"tag"`
	Search   string    `form:"search"`
	SortBy   string    `form:"sort_by,default=created_at"`
	SortOrder string   `form:"sort_order,default=desc"`
}

type PaginatedAPIs struct {
	Items      []*API `json:"items"`
	Total      int64  `json:"total"`
	Page       int    `json:"page"`
	PageSize   int    `json:"page_size"`
	TotalPages int    `json:"total_pages"`
}

// ─── Kafka Events ────────────────────────────────────────────
type APIEvent struct {
	EventType  string    `json:"event_type"`
	APIID      string    `json:"api_id"`
	APIName    string    `json:"api_name"`
	VersionID  string    `json:"version_id,omitempty"`
	Version    string    `json:"version,omitempty"`
	OrgID      string    `json:"org_id"`
	PerformedBy string   `json:"performed_by,omitempty"`
	Timestamp  time.Time `json:"timestamp"`
}

const (
	EventAPICreated     = "api.created"
	EventAPIUpdated     = "api.updated"
	EventAPIDeleted     = "api.deleted"
	EventVersionCreated = "api.version.created"
	EventVersionPublished = "api.version.published"
	EventVersionDeprecated = "api.version.deprecated"
	EventSpecUploaded   = "api.spec.uploaded"
)

// ─── Helpers ─────────────────────────────────────────────────
type JSONMap map[string]interface{}
