package plugins

import (
	"context"
	"fmt"

	"github.com/xcloudapim/policy-engine/internal/domain"
)

// Plugin 所有 Policy Plugin 必須實作的介面
type Plugin interface {
	// Type 回傳此 Plugin 對應的 PolicyType
	Type() domain.PolicyType
	// Execute 執行 Plugin 邏輯；修改 ctx 即可影響後續處理
	Execute(ctx context.Context, execCtx *domain.ExecContext, config map[string]string) error
	// Validate 驗證 config 設定的合法性（Compile 時期呼叫）
	Validate(config map[string]string) []string
}

// Registry Plugin 全域註冊表
type Registry struct {
	plugins map[domain.PolicyType]Plugin
}

func NewRegistry() *Registry {
	return &Registry{plugins: make(map[domain.PolicyType]Plugin)}
}

func (r *Registry) Register(p Plugin) {
	r.plugins[p.Type()] = p
}

func (r *Registry) Get(t domain.PolicyType) (Plugin, error) {
	p, ok := r.plugins[t]
	if !ok {
		return nil, fmt.Errorf("plugin not registered: %s", t)
	}
	return p, nil
}

func (r *Registry) Types() []domain.PolicyType {
	types := make([]domain.PolicyType, 0, len(r.plugins))
	for t := range r.plugins {
		types = append(types, t)
	}
	return types
}

// cfg 安全取值 helpers（避免 nil map panic）
func cfgGet(config map[string]string, key string) string {
	if config == nil {
		return ""
	}
	return config[key]
}

func cfgGetDefault(config map[string]string, key, def string) string {
	if v := cfgGet(config, key); v != "" {
		return v
	}
	return def
}
