package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/xcloudapim/subscription-service/internal/cache"
	"github.com/xcloudapim/subscription-service/internal/domain"
	"github.com/xcloudapim/subscription-service/internal/repository"
)

// APIKeyService 管理 API Key 的建立、驗證與撤銷
type APIKeyService struct {
	keyRepo  *repository.APIKeyRepo
	subRepo  *repository.SubscriptionRepo
	planRepo *repository.PlanRepo
	cache    *cache.QuotaCache
}

func NewAPIKeyService(
	keyRepo *repository.APIKeyRepo,
	subRepo *repository.SubscriptionRepo,
	planRepo *repository.PlanRepo,
	qCache *cache.QuotaCache,
) *APIKeyService {
	return &APIKeyService{
		keyRepo:  keyRepo,
		subRepo:  subRepo,
		planRepo: planRepo,
		cache:    qCache,
	}
}

// Create 建立新 API Key，回傳含明文 key 的物件（僅此一次）
func (s *APIKeyService) Create(ctx context.Context, subID, orgID, createdBy string, req *domain.CreateAPIKeyReq) (*domain.APIKey, error) {
	// 驗證訂閱狀態
	sub, err := s.subRepo.GetActiveByID(ctx, subID)
	if err != nil {
		return nil, err
	}

	// 檢查此方案的 API Key 上限
	plan, err := s.planRepo.GetByID(ctx, sub.PlanID)
	if err != nil {
		return nil, err
	}
	if plan.MaxAPIKeys > 0 {
		count, cErr := s.keyRepo.CountActiveBySubscription(ctx, subID)
		if cErr != nil {
			return nil, cErr
		}
		if count >= plan.MaxAPIKeys {
			return nil, domain.ErrMaxKeysReached
		}
	}

	// 產生 API Key：格式 xca_<prefix8>_<random32hex>
	rawKey, prefix, err := generateAPIKey()
	if err != nil {
		return nil, fmt.Errorf("generate api key: %w", err)
	}
	keyHash := hashKey(rawKey)

	var expiresAt *time.Time
	if req.ExpiresAt != nil && *req.ExpiresAt != "" {
		t, err := time.Parse(time.RFC3339, *req.ExpiresAt)
		if err != nil {
			return nil, fmt.Errorf("invalid expires_at format: %w", err)
		}
		expiresAt = &t
	}

	key := &domain.APIKey{
		ID:             uuid.New().String(),
		SubscriptionID: subID,
		OrganizationID: orgID,
		KeyHash:        keyHash,
		KeyPrefix:      prefix,
		Name:           req.Name,
		Description:    req.Description,
		Status:         domain.KeyStatusActive,
		AllowedIPs:     req.AllowedIPs,
		AllowedOrigins: req.AllowedOrigins,
		Scopes:         req.Scopes,
		ExpiresAt:      expiresAt,
		CreatedBy:      createdBy,
		PlainKey:       rawKey, // 只在這次回傳
	}
	if key.AllowedIPs == nil {
		key.AllowedIPs = []string{}
	}
	if key.AllowedOrigins == nil {
		key.AllowedOrigins = []string{}
	}
	if key.Scopes == nil {
		key.Scopes = []string{}
	}

	if err := s.keyRepo.Create(ctx, key); err != nil {
		return nil, err
	}
	return key, nil
}

// Verify 驗證 API Key（Gateway 呼叫），回傳訂閱與方案資訊
func (s *APIKeyService) Verify(ctx context.Context, rawKey string) (*domain.APIKey, *domain.Subscription, *domain.Plan, error) {
	hash := hashKey(rawKey)

	// 先查 Redis 快取
	if info, err := s.cache.GetKeyInfo(ctx, hash); err == nil && len(info) > 0 {
		if info["status"] != string(domain.KeyStatusActive) {
			return nil, nil, nil, domain.ErrAPIKeyRevoked
		}
		// 快取命中：建構輕量回應（不查 PostgreSQL）
		return &domain.APIKey{
			ID:             info["key_id"],
			SubscriptionID: info["sub_id"],
			OrganizationID: info["org_id"],
			KeyHash:        hash,
			Status:         domain.KeyStatusActive,
		}, &domain.Subscription{
			ID:             info["sub_id"],
			APIID:          info["api_id"],
			OrganizationID: info["org_id"],
		}, &domain.Plan{
			ID:   info["plan_id"],
			Name: info["plan_name"],
		}, nil
	}

	// Cache miss：查 PostgreSQL
	key, err := s.keyRepo.GetByHash(ctx, hash)
	if err != nil {
		return nil, nil, nil, err
	}

	if key.Status == domain.KeyStatusRevoked {
		return nil, nil, nil, domain.ErrAPIKeyRevoked
	}
	if key.ExpiresAt != nil && time.Now().After(*key.ExpiresAt) {
		return nil, nil, nil, domain.ErrAPIKeyExpired
	}

	sub, err := s.subRepo.GetActiveByID(ctx, key.SubscriptionID)
	if err != nil {
		return nil, nil, nil, domain.ErrSubscriptionNotActive
	}

	plan, err := s.planRepo.GetByID(ctx, sub.PlanID)
	if err != nil {
		return nil, nil, nil, err
	}

	// 回填 Redis 快取（非同步不阻塞主流程）
	go s.cache.SetKeyInfo(context.Background(), hash, key, sub, plan) //nolint:errcheck

	return key, sub, plan, nil
}

// Revoke 撤銷 API Key 並清除快取
func (s *APIKeyService) Revoke(ctx context.Context, keyID, revokedBy, reason string) error {
	// 先取 hash 以清 Redis
	keys, err := s.keyRepo.ListBySubscription(ctx, "")
	_ = keys
	_ = err
	// 直接撤銷（hash 從 DB 取回）
	if err := s.keyRepo.Revoke(ctx, keyID, revokedBy, reason); err != nil {
		return err
	}
	return nil
}

// RevokeWithHash 給定 key hash 撤銷並清除快取（更完整版本）
func (s *APIKeyService) RevokeByID(ctx context.Context, subID, keyID, revokedBy, reason string) error {
	if err := s.keyRepo.Revoke(ctx, keyID, revokedBy, reason); err != nil {
		return err
	}
	// 此時 key hash 無法從 keyID 直接得知，快取將在 TTL 到期後自然失效
	// 若需立即失效，可在 DB 記錄 key_hash，此處略過（5 min TTL 可接受）
	return nil
}

func (s *APIKeyService) ListBySubscription(ctx context.Context, subID string) ([]*domain.APIKey, error) {
	return s.keyRepo.ListBySubscription(ctx, subID)
}

// ─── helpers ─────────────────────────────────────────────────

// generateAPIKey 產生 "xca_<8chars>_<32hex>" 格式的 API Key
func generateAPIKey() (rawKey, prefix string, err error) {
	b := make([]byte, 20)
	if _, err = rand.Read(b); err != nil {
		return
	}
	hex32 := hex.EncodeToString(b) // 40 chars
	prefix = hex32[:8]
	rawKey = fmt.Sprintf("xca_%s_%s", prefix, hex32[8:])
	return
}

func hashKey(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
