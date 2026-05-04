package plugins

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/xcloudapim/policy-engine/internal/domain"
)

// CORSPlugin 處理跨來源資源共享（CORS）
// 支援 Preflight 快取、Credentials、動態 Origin 驗證
type CORSPlugin struct{}

func NewCORSPlugin() *CORSPlugin { return &CORSPlugin{} }

func (p *CORSPlugin) Type() domain.PolicyType { return domain.PolicyTypeCORS }

func (p *CORSPlugin) Validate(config map[string]string) []string {
	if cfgGet(config, "allowed_origins") == "" {
		return []string{"allowed_origins is required"}
	}
	return nil
}

func (p *CORSPlugin) Execute(ctx context.Context, execCtx *domain.ExecContext, config map[string]string) error {
	origin := execCtx.GetHeader("Origin")
	if origin == "" {
		return nil // 非 CORS 請求，跳過
	}

	allowedOrigins := parseCSV(cfgGetDefault(config, "allowed_origins", "*"))
	allowedMethods := parseCSV(cfgGetDefault(config, "allowed_methods", "GET,POST,PUT,DELETE,OPTIONS"))
	allowedHeaders := parseCSV(cfgGetDefault(config, "allowed_headers", "Content-Type,Authorization"))
	exposedHeaders := cfgGet(config, "exposed_headers")
	allowCredentials := cfgGet(config, "allow_credentials") == "true"
	maxAge := cfgGetDefault(config, "max_age", "3600")

	// 驗證 Origin
	originAllowed := originMatches(origin, allowedOrigins)
	if !originAllowed {
		execCtx.Abort(403, "CORS: origin not allowed")
		return nil
	}

	execCtx.SetResponseHeader("Access-Control-Allow-Origin", origin)
	execCtx.SetResponseHeader("Vary", "Origin")

	if allowCredentials {
		execCtx.SetResponseHeader("Access-Control-Allow-Credentials", "true")
	}
	if exposedHeaders != "" {
		execCtx.SetResponseHeader("Access-Control-Expose-Headers", exposedHeaders)
	}

	// Preflight（OPTIONS）
	if execCtx.Method == http.MethodOptions {
		execCtx.SetResponseHeader("Access-Control-Allow-Methods", strings.Join(allowedMethods, ", "))
		execCtx.SetResponseHeader("Access-Control-Allow-Headers", strings.Join(allowedHeaders, ", "))
		if _, err := strconv.Atoi(maxAge); err == nil {
			execCtx.SetResponseHeader("Access-Control-Max-Age", maxAge)
		}
		execCtx.Abort(http.StatusNoContent, "")
		return nil
	}

	return nil
}

func originMatches(origin string, allowed []string) bool {
	for _, a := range allowed {
		if a == "*" || strings.EqualFold(a, origin) {
			return true
		}
		// wildcard subdomain: *.example.com
		if strings.HasPrefix(a, "*.") {
			suffix := a[1:] // .example.com
			if strings.HasSuffix(strings.ToLower(origin), strings.ToLower(suffix)) {
				return true
			}
		}
	}
	return false
}

func parseCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}
