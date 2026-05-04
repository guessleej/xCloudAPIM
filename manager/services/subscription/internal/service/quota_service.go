package service

import (
	"context"

	"go.uber.org/zap"

	"github.com/xcloudapim/subscription-service/internal/cache"
	"github.com/xcloudapim/subscription-service/internal/domain"
	"github.com/xcloudapim/subscription-service/internal/repository"
)

// QuotaService 配額管理：即時 Redis 計數 + 非同步 PostgreSQL 持久化
type QuotaService struct {
	quotaRepo *repository.QuotaRepo
	subRepo   *repository.SubscriptionRepo
	planRepo  *repository.PlanRepo
	cache     *cache.QuotaCache
	log       *zap.Logger
}

func NewQuotaService(
	quotaRepo *repository.QuotaRepo,
	subRepo *repository.SubscriptionRepo,
	planRepo *repository.PlanRepo,
	qCache *cache.QuotaCache,
	log *zap.Logger,
) *QuotaService {
	return &QuotaService{
		quotaRepo: quotaRepo,
		subRepo:   subRepo,
		planRepo:  planRepo,
		cache:     qCache,
		log:       log,
	}
}

// GetClientQuota 取得客戶端的配額資訊（供 gRPC 呼叫）
func (s *QuotaService) GetClientQuota(ctx context.Context, clientID, apiID string) (*domain.ClientQuota, error) {
	sub, err := s.subRepo.GetActiveByID(ctx, clientID)
	if err != nil {
		// clientID 可能是 subscription_id 或 org_id，嘗試其他路徑
		return nil, err
	}

	plan, err := s.planRepo.GetByID(ctx, sub.PlanID)
	if err != nil {
		return nil, err
	}

	rpmUsed, _ := s.cache.GetRPM(ctx, clientID, apiID)
	dailyUsed, _ := s.cache.GetDaily(ctx, clientID, apiID)

	return &domain.ClientQuota{
		ClientID:     clientID,
		APIID:        apiID,
		RPMLimit:     plan.RPMLimit,
		DailyLimit:   plan.RPDLimit,
		MonthlyLimit: monthlyLimit(plan),
		Plan:         plan.Name,
		RPMUsed:      rpmUsed,
		DailyUsed:    dailyUsed,
	}, nil
}

// CheckQuota 檢查是否允許此次請求（不遞增計數）
func (s *QuotaService) CheckQuota(ctx context.Context, clientID, apiID string) (*domain.QuotaCheckResult, error) {
	quota, err := s.GetClientQuota(ctx, clientID, apiID)
	if err != nil {
		// Fail-open：無法取得配額時放行
		return &domain.QuotaCheckResult{Allowed: true}, nil
	}

	// -1 = unlimited
	if quota.RPMLimit > 0 && quota.RPMUsed >= quota.RPMLimit {
		return &domain.QuotaCheckResult{
			Allowed:      false,
			Reason:       "rpm limit exceeded",
			RemainingRPM: 0,
			RetryAfter:   60,
		}, nil
	}
	if quota.DailyLimit > 0 && quota.DailyUsed >= quota.DailyLimit {
		return &domain.QuotaCheckResult{
			Allowed:      false,
			Reason:       "daily limit exceeded",
			RemainingRPM: 0,
			RetryAfter:   86400,
		}, nil
	}

	remaining := int64(0)
	if quota.RPMLimit > 0 {
		remaining = quota.RPMLimit - quota.RPMUsed
	}
	return &domain.QuotaCheckResult{
		Allowed:      true,
		RemainingRPM: remaining,
	}, nil
}

// IncrementUsage 遞增使用量（Gateway 每次請求後呼叫）
func (s *QuotaService) IncrementUsage(ctx context.Context, clientID, apiID string, count int64) (int64, error) {
	// 遞增 Redis 即時計數
	rpmCount, err := s.cache.IncrRPM(ctx, clientID, apiID)
	if err != nil {
		s.log.Warn("redis rpm incr failed", zap.Error(err))
	}
	dailyCount, err := s.cache.IncrDaily(ctx, clientID, apiID)
	if err != nil {
		s.log.Warn("redis daily incr failed", zap.Error(err))
	}
	_ = dailyCount

	// 非同步持久化至 PostgreSQL（不阻塞請求路徑）
	go func() {
		bgCtx := context.Background()
		if err := s.quotaRepo.UpsertDaily(bgCtx, clientID, apiID, count, false); err != nil {
			s.log.Warn("quota daily upsert failed", zap.Error(err))
		}
		if err := s.quotaRepo.UpsertMonthly(bgCtx, clientID, apiID, count, 0, false); err != nil {
			s.log.Warn("quota monthly upsert failed", zap.Error(err))
		}
	}()

	return rpmCount, nil
}

// GetUsageHistory 取得每日用量歷史
func (s *QuotaService) GetUsageHistory(ctx context.Context, subID, apiID, from, to string) ([]*domain.QuotaUsageDaily, error) {
	return s.quotaRepo.GetDailyUsage(ctx, subID, apiID, from, to)
}

func monthlyLimit(p *domain.Plan) int64 {
	if p.RPMMonth != nil {
		return *p.RPMMonth
	}
	return -1 // unlimited
}
