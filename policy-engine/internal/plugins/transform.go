package plugins

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/xcloudapim/policy-engine/internal/domain"
)

// ─── Request Transform Plugin ─────────────────────────────────

// RequestTransformPlugin 修改 Request Headers、Body、URL
// config keys:
//   add_headers    = "Key1:Value1,Key2:Value2"
//   set_headers    = "Key1:Value1"
//   remove_headers = "X-Internal,X-Secret"
//   url_rewrite    = "^/v1/(.*):/$1"  (from:to 以 : 分隔)
//   inject_trace   = "true"           (注入 X-Trace-ID)
type RequestTransformPlugin struct{}

func NewRequestTransformPlugin() *RequestTransformPlugin { return &RequestTransformPlugin{} }

func (p *RequestTransformPlugin) Type() domain.PolicyType { return domain.PolicyTypeRequestTransform }

func (p *RequestTransformPlugin) Validate(config map[string]string) []string {
	if rewrite := cfgGet(config, "url_rewrite"); rewrite != "" {
		parts := strings.SplitN(rewrite, ":", 2)
		if len(parts) != 2 {
			return []string{"url_rewrite format must be 'from_regex:to_template'"}
		}
		if _, err := regexp.Compile(parts[0]); err != nil {
			return []string{"url_rewrite from pattern is invalid regex: " + err.Error()}
		}
	}
	return nil
}

func (p *RequestTransformPlugin) Execute(ctx context.Context, execCtx *domain.ExecContext, config map[string]string) error {
	// ─── Headers: Add ─────────────────────────────────────────
	if addHeaders := cfgGet(config, "add_headers"); addHeaders != "" {
		for _, pair := range parseKVPairs(addHeaders) {
			if execCtx.GetHeader(pair[0]) == "" { // 僅在不存在時 add
				execCtx.SetRequestHeader(pair[0], pair[1])
			}
		}
	}

	// ─── Headers: Set（強制覆寫） ─────────────────────────────
	if setHeaders := cfgGet(config, "set_headers"); setHeaders != "" {
		for _, pair := range parseKVPairs(setHeaders) {
			execCtx.SetRequestHeader(pair[0], pair[1])
		}
	}

	// ─── Headers: Remove ──────────────────────────────────────
	if removeHeaders := cfgGet(config, "remove_headers"); removeHeaders != "" {
		for _, key := range parseCSV(removeHeaders) {
			delete(execCtx.RequestHeaders, key)
			delete(execCtx.RequestHeaders, strings.ToLower(key))
		}
	}

	// ─── URL Rewrite ──────────────────────────────────────────
	if rewrite := cfgGet(config, "url_rewrite"); rewrite != "" {
		parts := strings.SplitN(rewrite, ":", 2)
		if len(parts) == 2 {
			re, err := regexp.Compile(parts[0])
			if err == nil {
				execCtx.Path = re.ReplaceAllString(execCtx.Path, parts[1])
			}
		}
	}

	// ─── Body Transform（JSONPath set/remove） ─────────────────
	if bodyTransforms := cfgGet(config, "body_transforms"); bodyTransforms != "" && len(execCtx.RequestBody) > 0 {
		transformed, err := applyBodyTransforms(execCtx.RequestBody, bodyTransforms)
		if err == nil {
			execCtx.RequestBody = transformed
		}
	}

	// ─── 注入 Trace Header ────────────────────────────────────
	if cfgGet(config, "inject_trace") == "true" && execCtx.TraceID != "" {
		execCtx.SetRequestHeader("X-Trace-ID", execCtx.TraceID)
		execCtx.SetRequestHeader("X-Request-ID", execCtx.TraceID)
	}

	return nil
}

// ─── Response Transform Plugin ────────────────────────────────

// ResponseTransformPlugin 修改 Response Headers、Body 敏感欄位遮罩
// config keys:
//   add_headers     = "Key1:Value1"
//   remove_headers  = "Server,X-Powered-By"
//   mask_fields     = "password,token,secret"  (JSON body 欄位遮罩)
type ResponseTransformPlugin struct{}

func NewResponseTransformPlugin() *ResponseTransformPlugin { return &ResponseTransformPlugin{} }

func (p *ResponseTransformPlugin) Type() domain.PolicyType { return domain.PolicyTypeResponseTransform }

func (p *ResponseTransformPlugin) Validate(config map[string]string) []string { return nil }

func (p *ResponseTransformPlugin) Execute(ctx context.Context, execCtx *domain.ExecContext, config map[string]string) error {
	// ─── Response Headers ─────────────────────────────────────
	if addHeaders := cfgGet(config, "add_headers"); addHeaders != "" {
		for _, pair := range parseKVPairs(addHeaders) {
			execCtx.SetResponseHeader(pair[0], pair[1])
		}
	}
	if removeHeaders := cfgGet(config, "remove_headers"); removeHeaders != "" {
		for _, key := range parseCSV(removeHeaders) {
			delete(execCtx.ResponseHeaders, key)
			delete(execCtx.ResponseHeaders, strings.ToLower(key))
		}
	}
	// 安全預設：移除洩漏伺服器資訊的標頭
	delete(execCtx.ResponseHeaders, "Server")
	delete(execCtx.ResponseHeaders, "X-Powered-By")

	// ─── Body 敏感欄位遮罩 ────────────────────────────────────
	if maskFields := cfgGet(config, "mask_fields"); maskFields != "" && len(execCtx.ResponseBody) > 0 {
		fields := parseCSV(maskFields)
		masked, err := maskJSONFields(execCtx.ResponseBody, fields)
		if err == nil {
			execCtx.ResponseBody = masked
		}
	}

	return nil
}

// ─── Helpers ─────────────────────────────────────────────────

// parseKVPairs 解析 "Key1:Value1,Key2:Value2" 格式
func parseKVPairs(s string) [][2]string {
	var pairs [][2]string
	for _, entry := range parseCSV(s) {
		idx := strings.Index(entry, ":")
		if idx < 0 {
			continue
		}
		pairs = append(pairs, [2]string{
			strings.TrimSpace(entry[:idx]),
			strings.TrimSpace(entry[idx+1:]),
		})
	}
	return pairs
}

// applyBodyTransforms 套用 JSON body 轉換（格式：JSONPath=value）
func applyBodyTransforms(body []byte, transforms string) ([]byte, error) {
	var obj map[string]interface{}
	if err := json.Unmarshal(body, &obj); err != nil {
		return body, nil // 非 JSON，跳過
	}
	for _, t := range parseCSV(transforms) {
		parts := strings.SplitN(t, "=", 2)
		if len(parts) != 2 {
			continue
		}
		setJSONPath(obj, strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1]))
	}
	return json.Marshal(obj)
}

// maskJSONFields 遮罩 JSON body 中的敏感欄位（支援深層路徑 a.b.c）
func maskJSONFields(body []byte, fields []string) ([]byte, error) {
	var obj interface{}
	if err := json.Unmarshal(body, &obj); err != nil {
		return body, nil
	}
	for _, field := range fields {
		maskField(obj, strings.Split(field, "."))
	}
	return json.Marshal(obj)
}

func maskField(obj interface{}, path []string) {
	if len(path) == 0 {
		return
	}
	m, ok := obj.(map[string]interface{})
	if !ok {
		return
	}
	if len(path) == 1 {
		if _, exists := m[path[0]]; exists {
			m[path[0]] = "***"
		}
		return
	}
	maskField(m[path[0]], path[1:])
}

func setJSONPath(obj map[string]interface{}, path, value string) {
	parts := strings.SplitN(path, ".", 2)
	if len(parts) == 1 {
		obj[path] = value
		return
	}
	if sub, ok := obj[parts[0]].(map[string]interface{}); ok {
		setJSONPath(sub, parts[1], value)
	}
}

// ─── Unused import prevention ─────────────────────────────────
var _ = fmt.Sprintf
