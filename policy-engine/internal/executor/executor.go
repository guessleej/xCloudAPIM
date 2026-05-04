package executor

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"go.uber.org/zap"

	"github.com/xcloudapim/policy-engine/internal/domain"
	"github.com/xcloudapim/policy-engine/internal/plugins"
)

// Executor Policy Chain 執行引擎
// 依 Phase 順序執行各 Plugin，支援 Abort 短路、條件式跳過、逾時控制
type Executor struct {
	registry *plugins.Registry
	log      *zap.Logger
}

func New(registry *plugins.Registry, log *zap.Logger) *Executor {
	return &Executor{registry: registry, log: log}
}

// ExecResult 執行結果摘要
type ExecResult struct {
	Aborted    bool
	AbortCode  int
	AbortMsg   string
	CacheHit   bool
	Duration   time.Duration
	PhaseStats map[domain.PolicyPhase]int // 各 Phase 執行的 plugin 數
}

// Execute 執行整條 Policy Chain（分四個 Phase）
//
// phaseFilter 非空時只執行指定 Phase（Gateway 分開呼叫 pre/post）
func (e *Executor) Execute(
	ctx context.Context,
	chain *domain.PolicyChain,
	execCtx *domain.ExecContext,
	phaseFilter ...domain.PolicyPhase,
) (*ExecResult, error) {
	start := time.Now()
	result := &ExecResult{
		PhaseStats: make(map[domain.PolicyPhase]int),
	}

	// 按 Phase + Order 排序後執行
	ordered := sortedPolicies(chain.Policies)
	filterSet := make(map[domain.PolicyPhase]bool, len(phaseFilter))
	for _, ph := range phaseFilter {
		filterSet[ph] = true
	}

	for _, policy := range ordered {
		if !policy.Enabled {
			continue
		}
		if len(filterSet) > 0 && !filterSet[policy.Phase] {
			continue
		}

		// 條件判斷（簡易 key=value 表達式）
		if policy.Condition != "" && !evalCondition(policy.Condition, execCtx) {
			e.log.Debug("policy skipped by condition",
				zap.String("policy_id", policy.ID),
				zap.String("condition", policy.Condition),
			)
			continue
		}

		plugin, err := e.registry.Get(policy.Type)
		if err != nil {
			e.log.Warn("plugin not found", zap.String("type", string(policy.Type)))
			continue
		}

		if err := plugin.Execute(ctx, execCtx, policy.Config); err != nil {
			e.log.Error("plugin execute error",
				zap.String("policy_id", policy.ID),
				zap.String("type", string(policy.Type)),
				zap.Error(err),
			)
			// Plugin 內部錯誤視為 500
			execCtx.Abort(500, fmt.Sprintf("policy engine internal error: %s", policy.Type))
		}

		result.PhaseStats[policy.Phase]++

		if execCtx.Aborted {
			result.Aborted = true
			result.AbortCode = execCtx.AbortCode
			result.AbortMsg = execCtx.AbortMsg
			// Cache HIT 特殊情況不算 abort 短路
			if execCtx.CacheHit {
				result.CacheHit = true
			}
			break
		}

		// Cache HIT 直接回應，不呼叫上游
		if execCtx.CacheHit {
			result.CacheHit = true
			break
		}
	}

	result.Duration = time.Since(start)
	return result, nil
}

// ExecutePhase 只執行單一 Phase（效能最佳化版本，減少 map lookup）
func (e *Executor) ExecutePhase(
	ctx context.Context,
	chain *domain.PolicyChain,
	execCtx *domain.ExecContext,
	phase domain.PolicyPhase,
) (*ExecResult, error) {
	return e.Execute(ctx, chain, execCtx, phase)
}

// ─── Helpers ─────────────────────────────────────────────────

func sortedPolicies(policies []*domain.Policy) []*domain.Policy {
	sorted := make([]*domain.Policy, len(policies))
	copy(sorted, policies)
	sort.Slice(sorted, func(i, j int) bool {
		pi, pj := sorted[i], sorted[j]
		phI := domain.PhaseOrder[pi.Phase]
		phJ := domain.PhaseOrder[pj.Phase]
		if phI != phJ {
			return phI < phJ
		}
		return pi.Order < pj.Order
	})
	return sorted
}

// evalCondition 解析簡易條件表達式
// 支援格式:
//   "header.X-Client-Plan=premium"
//   "claim.plan=pro"
//   "method=POST"
func evalCondition(cond string, execCtx *domain.ExecContext) bool {
	parts := strings.SplitN(cond, "=", 2)
	if len(parts) != 2 {
		return true // 無法解析 → 視為通過
	}
	key := strings.TrimSpace(parts[0])
	expected := strings.TrimSpace(parts[1])

	switch {
	case strings.HasPrefix(key, "header."):
		h := key[len("header."):]
		return execCtx.GetHeader(h) == expected

	case strings.HasPrefix(key, "claim."):
		c := key[len("claim."):]
		v, _ := execCtx.Claims[c].(string)
		return v == expected

	case key == "method":
		return strings.EqualFold(execCtx.Method, expected)

	case key == "plan":
		return execCtx.Plan == expected
	}

	return true
}
