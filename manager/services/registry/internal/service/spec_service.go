package service

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/xcloudapim/registry-service/internal/domain"
	"gopkg.in/yaml.v3"
)

// SpecService 負責 OpenAPI 3.x Spec 的解析與驗證
type SpecService struct{}

func NewSpecService() *SpecService { return &SpecService{} }

// Parse 解析 OpenAPI Spec 並回傳摘要
func (s *SpecService) Parse(format, content string) (*domain.SpecSummary, error) {
	if strings.TrimSpace(content) == "" {
		return nil, domain.ErrInvalidInput("spec content is empty")
	}

	var raw map[string]interface{}
	var err error

	switch strings.ToLower(format) {
	case "yaml", "yml":
		err = yaml.Unmarshal([]byte(content), &raw)
	case "json":
		err = json.Unmarshal([]byte(content), &raw)
	default:
		return nil, domain.ErrInvalidInput("unsupported format: " + format + " (must be yaml or json)")
	}
	if err != nil {
		return nil, &domain.ServiceError{
			Code:    "SPEC_PARSE_FAILED",
			Message: "Failed to parse OpenAPI spec",
			Detail:  err.Error(),
			Status:  400,
		}
	}

	return s.extractSummary(raw)
}

// Validate 驗證是否為合法 OpenAPI 3.x
func (s *SpecService) Validate(format, content string) error {
	var raw map[string]interface{}
	switch strings.ToLower(format) {
	case "yaml", "yml":
		if err := yaml.Unmarshal([]byte(content), &raw); err != nil {
			return domain.ErrSpecParseFailed
		}
	case "json":
		if err := json.Unmarshal([]byte(content), &raw); err != nil {
			return domain.ErrSpecParseFailed
		}
	}

	errs := []string{}

	// 必要欄位檢查
	if _, ok := raw["openapi"]; !ok {
		errs = append(errs, "missing required field: openapi")
	} else if ver, _ := raw["openapi"].(string); !strings.HasPrefix(ver, "3.") {
		errs = append(errs, fmt.Sprintf("unsupported OpenAPI version: %s (must be 3.x)", ver))
	}
	if info, ok := raw["info"].(map[string]interface{}); !ok {
		errs = append(errs, "missing required field: info")
	} else {
		if _, ok := info["title"]; !ok {
			errs = append(errs, "info.title is required")
		}
		if _, ok := info["version"]; !ok {
			errs = append(errs, "info.version is required")
		}
	}
	if _, ok := raw["paths"]; !ok {
		errs = append(errs, "missing required field: paths")
	}

	if len(errs) > 0 {
		return &domain.ServiceError{
			Code:    "SPEC_INVALID",
			Message: "OpenAPI spec validation failed",
			Detail:  strings.Join(errs, "; "),
			Status:  400,
		}
	}
	return nil
}

// NormalizeToYAML 將任意格式轉換為 YAML 儲存
func (s *SpecService) NormalizeToYAML(format, content string) (string, error) {
	if strings.ToLower(format) == "yaml" {
		return content, nil
	}
	// JSON → map → YAML
	var raw map[string]interface{}
	if err := json.Unmarshal([]byte(content), &raw); err != nil {
		return "", fmt.Errorf("parse json spec: %w", err)
	}
	out, err := yaml.Marshal(raw)
	if err != nil {
		return "", fmt.Errorf("marshal to yaml: %w", err)
	}
	return string(out), nil
}

// ConvertToJSON 將 YAML spec 轉換為 JSON（供前端使用）
func (s *SpecService) ConvertToJSON(yamlContent string) (string, error) {
	var raw map[string]interface{}
	if err := yaml.Unmarshal([]byte(yamlContent), &raw); err != nil {
		return "", fmt.Errorf("parse yaml: %w", err)
	}
	b, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal to json: %w", err)
	}
	return string(b), nil
}

// ─── Private ─────────────────────────────────────────────────

func (s *SpecService) extractSummary(raw map[string]interface{}) (*domain.SpecSummary, error) {
	summary := &domain.SpecSummary{}

	// info
	if info, ok := raw["info"].(map[string]interface{}); ok {
		summary.Title, _ = info["title"].(string)
		summary.Description, _ = info["description"].(string)
		summary.Version, _ = info["version"].(string)
	}

	// servers
	if servers, ok := raw["servers"].([]interface{}); ok {
		for _, srv := range servers {
			if m, ok := srv.(map[string]interface{}); ok {
				s := domain.SpecServer{}
				s.URL, _ = m["url"].(string)
				s.Description, _ = m["description"].(string)
				if s.URL != "" {
					summary.Servers = append(summary.Servers, s)
				}
			}
		}
	}

	// paths → endpoints
	if paths, ok := raw["paths"].(map[string]interface{}); ok {
		summary.PathCount = len(paths)
		methods := []string{"get", "post", "put", "patch", "delete", "head", "options"}

		for path, pathItem := range paths {
			if pi, ok := pathItem.(map[string]interface{}); ok {
				for _, method := range methods {
					if op, ok := pi[method].(map[string]interface{}); ok {
						ep := domain.SpecEndpoint{
							Path:   path,
							Method: strings.ToUpper(method),
						}
						ep.Summary, _ = op["summary"].(string)
						ep.Description, _ = op["description"].(string)
						ep.Deprecated, _ = op["deprecated"].(bool)

						if tags, ok := op["tags"].([]interface{}); ok {
							for _, t := range tags {
								if ts, ok := t.(string); ok {
									ep.Tags = append(ep.Tags, ts)
								}
							}
						}
						summary.Endpoints = append(summary.Endpoints, ep)
					}
				}
			}
		}
	}

	// global tags
	if tags, ok := raw["tags"].([]interface{}); ok {
		for _, t := range tags {
			if tm, ok := t.(map[string]interface{}); ok {
				if name, ok := tm["name"].(string); ok {
					summary.TagList = append(summary.TagList, name)
				}
			}
		}
	}

	return summary, nil
}
