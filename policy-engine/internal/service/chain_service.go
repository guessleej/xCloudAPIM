package service

import (
	"context"
	"fmt"

	"github.com/xcloudapim/policy-engine/internal/domain"
	"github.com/xcloudapim/policy-engine/internal/repository"
	"github.com/xcloudapim/policy-engine/internal/store"
	"go.uber.org/zap"
)

// ChainService 管理側業務邏輯
// - 讀取路徑 (Gateway GET /v1/chains/:apiId) → store.ChainRepository (Redis + PostgreSQL snapshot)
// - 寫入路徑 (BFF mutations / Studio) → repository.ManagementRepo (policy_chains + policies)
type ChainService struct {
	mgmtRepo   *repository.ManagementRepo
	storeRepo  *store.ChainRepository // read side: Redis L1 + PostgreSQL L2
	logger     *zap.Logger
}

func NewChainService(
	mgmtRepo *repository.ManagementRepo,
	storeRepo *store.ChainRepository,
	logger *zap.Logger,
) *ChainService {
	return &ChainService{
		mgmtRepo:  mgmtRepo,
		storeRepo: storeRepo,
		logger:    logger,
	}
}

// ─── Gateway Read Path ────────────────────────────────────────

// GetGatewayChain returns the published chain in Gateway format.
// Results are served from Redis L1 cache (5 min TTL) → PostgreSQL L2.
func (s *ChainService) GetGatewayChain(ctx context.Context, apiID string) (*domain.PolicyChain, error) {
	return s.storeRepo.GetByAPIID(ctx, apiID)
}

// ─── Management CRUD ──────────────────────────────────────────

func (s *ChainService) ListChains(ctx context.Context, orgID string) ([]*repository.ManagementChain, error) {
	return s.mgmtRepo.ListByOrg(ctx, orgID)
}

func (s *ChainService) GetChain(ctx context.Context, id string) (*repository.ManagementChain, error) {
	chain, err := s.mgmtRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	policies, err := s.mgmtRepo.ListPolicies(ctx, id)
	if err != nil {
		return nil, err
	}
	chain.Policies = policies
	return chain, nil
}

func (s *ChainService) CreateChain(ctx context.Context, req *domain.CreateChainRequest, orgID, userID string) (*repository.ManagementChain, error) {
	return s.mgmtRepo.Create(ctx, orgID, req.Name, req.Description, req.APIID, userID)
}

func (s *ChainService) UpdateChain(ctx context.Context, id string, req *domain.UpdateChainRequest) (*repository.ManagementChain, error) {
	chain, err := s.mgmtRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if chain.Status != "draft" {
		return nil, domain.ErrChainNotDraft
	}
	name := chain.Name
	desc := chain.Description
	if req.Name != nil {
		name = *req.Name
	}
	if req.Description != nil {
		desc = *req.Description
	}
	if err := s.mgmtRepo.Update(ctx, id, name, desc); err != nil {
		return nil, err
	}
	return s.GetChain(ctx, id)
}

func (s *ChainService) PublishChain(ctx context.Context, id, userID string, req *domain.PublishChainRequest) (*repository.ManagementChain, error) {
	if err := s.mgmtRepo.Publish(ctx, id, userID, req.ChangeSummary); err != nil {
		return nil, err
	}
	// Invalidate cache so Gateway picks up new version immediately
	chain, err := s.mgmtRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if chain.APIID != nil && *chain.APIID != "" {
		if err := s.storeRepo.InvalidateCache(ctx, *chain.APIID); err != nil {
			s.logger.Warn("cache invalidation failed", zap.Error(err))
		}
	}
	return s.GetChain(ctx, id)
}

func (s *ChainService) DeleteChain(ctx context.Context, id string) error {
	return s.mgmtRepo.SoftDelete(ctx, id)
}

func (s *ChainService) InvalidateCache(ctx context.Context, apiID string) error {
	return s.storeRepo.InvalidateCache(ctx, apiID)
}

// ─── Policy CRUD ──────────────────────────────────────────────

func (s *ChainService) ListPolicies(ctx context.Context, chainID string) ([]domain.Policy, error) {
	return s.mgmtRepo.ListPolicies(ctx, chainID)
}

func (s *ChainService) CreatePolicy(ctx context.Context, chainID string, req *domain.CreatePolicyRequest) (*domain.Policy, error) {
	chain, err := s.mgmtRepo.GetByID(ctx, chainID)
	if err != nil {
		return nil, err
	}
	if chain.Status != "draft" {
		return nil, domain.ErrChainNotDraft
	}
	return s.mgmtRepo.CreatePolicy(ctx, chainID, req)
}

func (s *ChainService) UpdatePolicy(ctx context.Context, chainID, policyID string, req *domain.UpdatePolicyRequest) error {
	chain, err := s.mgmtRepo.GetByID(ctx, chainID)
	if err != nil {
		return err
	}
	if chain.Status != "draft" {
		return domain.ErrChainNotDraft
	}
	return s.mgmtRepo.UpdatePolicy(ctx, policyID, req)
}

func (s *ChainService) DeletePolicy(ctx context.Context, chainID, policyID string) error {
	chain, err := s.mgmtRepo.GetByID(ctx, chainID)
	if err != nil {
		return err
	}
	if chain.Status != "draft" {
		return domain.ErrChainNotDraft
	}
	return s.mgmtRepo.DeletePolicy(ctx, policyID)
}

// ─── Templates ────────────────────────────────────────────────

type PolicyTemplate struct {
	ID            string   `json:"id"             db:"id"`
	Type          string   `json:"type"           db:"type"`
	Name          string   `json:"name"           db:"name"`
	Description   string   `json:"description"    db:"description"`
	ConfigSchema  string   `json:"config_schema"  db:"config_schema"`
	DefaultConfig string   `json:"default_config" db:"default_config"`
	Icon          string   `json:"icon"           db:"icon"`
	Color         string   `json:"color"          db:"color"`
	Tags          []string `json:"tags"           db:"tags"`
	Version       string   `json:"version"        db:"version"`
}

func (s *ChainService) ListTemplates(ctx context.Context) ([]PolicyTemplate, error) {
	var templates []PolicyTemplate
	err := s.mgmtRepo.DB().SelectContext(ctx, &templates, `
		SELECT id, type::text, name, description,
		       config_schema::text, default_config::text,
		       icon, color, tags, version
		FROM policy_templates WHERE is_active = TRUE ORDER BY type, name`)
	if err != nil {
		return nil, fmt.Errorf("list templates: %w", err)
	}
	return templates, nil
}
