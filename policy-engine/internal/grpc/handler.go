package grpc

import (
	"context"
	"crypto/md5"
	"encoding/json"
	"fmt"

	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/xcloudapim/policy-engine/internal/compiler"
	"github.com/xcloudapim/policy-engine/internal/domain"
	"github.com/xcloudapim/policy-engine/internal/executor"
	"github.com/xcloudapim/policy-engine/internal/store"
)

// Handler 實作 PolicyEngineService gRPC 方法
type Handler struct {
	repo     *store.ChainRepository
	compiler *compiler.Compiler
	executor *executor.Executor
	log      *zap.Logger
}

func NewHandler(
	repo *store.ChainRepository,
	compiler *compiler.Compiler,
	executor *executor.Executor,
	log *zap.Logger,
) *Handler {
	return &Handler{
		repo:     repo,
		compiler: compiler,
		executor: executor,
		log:      log,
	}
}

// ─── GetPolicies ──────────────────────────────────────────────

type GetPoliciesRequest struct {
	APIID  string
	Path   string
	Method string
}

type PolicyChainResponse struct {
	APIID    string            `json:"api_id"`
	ChainID  string            `json:"chain_id"`
	Policies []*PolicyResponse `json:"policies"`
	Version  int64             `json:"version"`
	ETag     string            `json:"etag"`
}

type PolicyResponse struct {
	ID      string            `json:"id"`
	Type    string            `json:"type"`
	Phase   string            `json:"phase"`
	Order   int               `json:"order"`
	Enabled bool              `json:"enabled"`
	Config  map[string]string `json:"config"`
}

func (h *Handler) GetPolicies(ctx context.Context, req *GetPoliciesRequest) (*PolicyChainResponse, error) {
	chain, err := h.repo.GetByAPIID(ctx, req.APIID)
	if err != nil {
		return nil, status.Errorf(codes.NotFound, "policy chain not found for api_id: %s", req.APIID)
	}

	resp := &PolicyChainResponse{
		APIID:    chain.APIID,
		ChainID:  chain.ID,
		Version:  chain.Version,
		ETag:     chain.ETag,
		Policies: make([]*PolicyResponse, 0, len(chain.Policies)),
	}
	for _, p := range chain.Policies {
		resp.Policies = append(resp.Policies, &PolicyResponse{
			ID:      p.ID,
			Type:    string(p.Type),
			Phase:   string(p.Phase),
			Order:   p.Order,
			Enabled: p.Enabled,
			Config:  p.Config,
		})
	}
	return resp, nil
}

// ─── CompilePolicy ────────────────────────────────────────────

type CompilePolicyRequest struct {
	PolicyDSL string
	Format    string // yaml | json
}

type CompileResult struct {
	Success  bool
	Bytecode []byte
	ErrorMsg string
}

func (h *Handler) CompilePolicy(ctx context.Context, req *CompilePolicyRequest) (*CompileResult, error) {
	chain, errs, err := h.compiler.Compile([]byte(req.PolicyDSL), req.Format)
	if err != nil {
		return &CompileResult{
			Success:  false,
			ErrorMsg: fmt.Sprintf("%v: %v", err, errs),
		}, nil
	}

	bytecode, err := json.Marshal(chain)
	if err != nil {
		return &CompileResult{Success: false, ErrorMsg: err.Error()}, nil
	}
	return &CompileResult{Success: true, Bytecode: bytecode}, nil
}

// ─── ValidatePolicy ───────────────────────────────────────────

type ValidatePolicyRequest struct {
	PolicyDSL string
	Format    string
}

type ValidationResult struct {
	Valid    bool
	Errors   []string
	Warnings []string
}

func (h *Handler) ValidatePolicy(ctx context.Context, req *ValidatePolicyRequest) (*ValidationResult, error) {
	errs := h.compiler.Validate([]byte(req.PolicyDSL), req.Format)
	return &ValidationResult{
		Valid:  len(errs) == 0,
		Errors: errs,
	}, nil
}

// ─── PublishChain ─────────────────────────────────────────────

type PublishChainRequest struct {
	ChainID string
	APIID   string
}

type PublishResult struct {
	Success bool
	Version string
}

func (h *Handler) PublishChain(ctx context.Context, req *PublishChainRequest) (*PublishResult, error) {
	chain, err := h.repo.GetByAPIID(ctx, req.APIID)
	if err != nil {
		return &PublishResult{Success: false}, status.Errorf(codes.NotFound, "chain not found")
	}

	chain.Version++
	chain.ETag = computeETag(chain)

	if err := h.repo.SaveAndPublish(ctx, chain); err != nil {
		return &PublishResult{Success: false}, status.Errorf(codes.Internal, "publish failed: %v", err)
	}

	return &PublishResult{
		Success: true,
		Version: fmt.Sprintf("%d", chain.Version),
	}, nil
}

// ─── InvalidateCache ──────────────────────────────────────────

type InvalidateCacheRequest struct {
	APIID string
}

type InvalidateCacheResult struct {
	Success bool
}

func (h *Handler) InvalidateCache(ctx context.Context, req *InvalidateCacheRequest) (*InvalidateCacheResult, error) {
	if err := h.repo.InvalidateCache(ctx, req.APIID); err != nil {
		h.log.Warn("invalidate cache failed", zap.String("api_id", req.APIID), zap.Error(err))
		return &InvalidateCacheResult{Success: false}, nil
	}
	return &InvalidateCacheResult{Success: true}, nil
}

// ─── ExecuteChain（内部呼叫，供 Gateway gRPC Proxy 使用）────────

type ExecuteRequest struct {
	ExecCtx *domain.ExecContext
	Phase   domain.PolicyPhase
}

type ExecuteResponse struct {
	Aborted   bool
	AbortCode int
	AbortMsg  string
	CacheHit  bool
}

func (h *Handler) ExecuteChain(ctx context.Context, req *ExecuteRequest) (*ExecuteResponse, error) {
	chain, err := h.repo.GetByAPIID(ctx, req.ExecCtx.APIID)
	if err != nil {
		// Fail-open：無 Policy Chain 時放行
		h.log.Warn("chain not found, fail-open", zap.String("api_id", req.ExecCtx.APIID))
		return &ExecuteResponse{}, nil
	}

	result, err := h.executor.ExecutePhase(ctx, chain, req.ExecCtx, req.Phase)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "executor error: %v", err)
	}

	return &ExecuteResponse{
		Aborted:   result.Aborted,
		AbortCode: result.AbortCode,
		AbortMsg:  result.AbortMsg,
		CacheHit:  result.CacheHit,
	}, nil
}

// ─── Helpers ─────────────────────────────────────────────────

func computeETag(chain *domain.PolicyChain) string {
	data, _ := json.Marshal(chain.Policies)
	return fmt.Sprintf("%x", md5.Sum(data))
}
