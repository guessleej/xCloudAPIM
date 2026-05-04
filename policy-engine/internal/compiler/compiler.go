package compiler

import (
	"encoding/json"
	"fmt"
	"sort"

	"github.com/google/uuid"
	"github.com/xcloudapim/policy-engine/internal/domain"
	"github.com/xcloudapim/policy-engine/internal/plugins"
	"gopkg.in/yaml.v3"
)

// PolicyDSL Policy 鏈的宣告式定義（YAML / JSON 格式）
type PolicyDSL struct {
	ChainID string       `yaml:"chain_id" json:"chain_id"`
	APIID   string       `yaml:"api_id"   json:"api_id"`
	Version int64        `yaml:"version"  json:"version"`
	Policies []PolicyDef `yaml:"policies" json:"policies"`
}

type PolicyDef struct {
	ID        string            `yaml:"id"        json:"id"`
	Type      string            `yaml:"type"      json:"type"`
	Phase     string            `yaml:"phase"     json:"phase"`
	Order     int               `yaml:"order"     json:"order"`
	Enabled   bool              `yaml:"enabled"   json:"enabled"`
	Config    map[string]string `yaml:"config"    json:"config"`
	Condition string            `yaml:"condition" json:"condition"`
}

// Compiler 將 DSL 編譯為可執行的 domain.PolicyChain
type Compiler struct {
	registry *plugins.Registry
}

func New(registry *plugins.Registry) *Compiler {
	return &Compiler{registry: registry}
}

// Compile 解析 DSL（yaml|json）並驗證所有 Plugin 設定，回傳 PolicyChain
func (c *Compiler) Compile(dslBytes []byte, format string) (*domain.PolicyChain, []string, error) {
	var dsl PolicyDSL
	var err error

	switch format {
	case "json":
		err = json.Unmarshal(dslBytes, &dsl)
	default: // yaml
		err = yaml.Unmarshal(dslBytes, &dsl)
	}
	if err != nil {
		return nil, nil, fmt.Errorf("parse DSL: %w", err)
	}

	return c.CompileFromDSL(&dsl)
}

// CompileFromDSL 從已解析的 DSL 結構編譯，回傳 (chain, warnings, error)
func (c *Compiler) CompileFromDSL(dsl *PolicyDSL) (*domain.PolicyChain, []string, error) {
	var allErrs []string

	if dsl.APIID == "" {
		allErrs = append(allErrs, "api_id is required")
	}

	chain := &domain.PolicyChain{
		ID:      dsl.ChainID,
		APIID:   dsl.APIID,
		Version: dsl.Version,
	}
	if chain.ID == "" {
		chain.ID = uuid.New().String()
	}

	policies := make([]*domain.Policy, 0, len(dsl.Policies))
	for i, def := range dsl.Policies {
		pType := domain.PolicyType(def.Type)
		plugin, pluginErr := c.registry.Get(pType)
		if pluginErr != nil {
			allErrs = append(allErrs, fmt.Sprintf("policy[%d]: unknown type %q", i, def.Type))
			continue
		}

		phase := domain.PolicyPhase(def.Phase)
		if _, ok := domain.PhaseOrder[phase]; !ok {
			allErrs = append(allErrs, fmt.Sprintf("policy[%d]: unknown phase %q", i, def.Phase))
			continue
		}

		// 呼叫 Plugin 自身的 Validate
		if errs := plugin.Validate(def.Config); len(errs) > 0 {
			for _, e := range errs {
				allErrs = append(allErrs, fmt.Sprintf("policy[%d](%s): %s", i, def.Type, e))
			}
			continue
		}

		id := def.ID
		if id == "" {
			id = uuid.New().String()
		}

		policies = append(policies, &domain.Policy{
			ID:        id,
			Type:      pType,
			Phase:     phase,
			Order:     def.Order,
			Enabled:   def.Enabled,
			Config:    def.Config,
			Condition: def.Condition,
		})
	}

	if len(allErrs) > 0 {
		return nil, allErrs, fmt.Errorf("compilation failed with %d error(s)", len(allErrs))
	}

	// 依 Phase 順序 + Order 排序
	sort.Slice(policies, func(i, j int) bool {
		pi, pj := policies[i], policies[j]
		phaseI := domain.PhaseOrder[pi.Phase]
		phaseJ := domain.PhaseOrder[pj.Phase]
		if phaseI != phaseJ {
			return phaseI < phaseJ
		}
		return pi.Order < pj.Order
	})

	chain.Policies = policies
	return chain, nil, nil
}

// Validate 僅驗證，不產生 chain（提供給 gRPC ValidatePolicy 端點）
func (c *Compiler) Validate(dslBytes []byte, format string) []string {
	var dsl PolicyDSL
	var err error
	switch format {
	case "json":
		err = json.Unmarshal(dslBytes, &dsl)
	default:
		err = yaml.Unmarshal(dslBytes, &dsl)
	}
	if err != nil {
		return []string{"parse error: " + err.Error()}
	}

	_, errs, _ := c.CompileFromDSL(&dsl)
	return errs
}
