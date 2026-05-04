package cache

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/xcloudapim/subscription-service/internal/domain"
)

// QuotaCache 即時配額計數（Redis），供 Gateway 高頻呼叫
type QuotaCache struct {
	rdb *redis.Client
}

func NewQuotaCache(rdb *redis.Client) *QuotaCache {
	return &QuotaCache{rdb: rdb}
}

// ─── API Key 驗證快取 ─────────────────────────────────────────

// SetKeyInfo 快取 API Key 的訂閱資訊（TTL 5 分鐘）
func (c *QuotaCache) SetKeyInfo(ctx context.Context, hash string, key *domain.APIKey, sub *domain.Subscription, plan *domain.Plan) error {
	pipe := c.rdb.Pipeline()
	k := keyInfoKey(hash)
	pipe.HSet(ctx, k,
		"key_id",   key.ID,
		"sub_id",   sub.ID,
		"api_id",   sub.APIID,
		"org_id",   sub.OrganizationID,
		"plan_id",  plan.ID,
		"plan_name", plan.Name,
		"rpm_limit",   fmt.Sprintf("%d", plan.RPMLimit),
		"rpd_limit",   fmt.Sprintf("%d", plan.RPDLimit),
		"status",   string(key.Status),
	)
	pipe.Expire(ctx, k, 5*time.Minute)
	_, err := pipe.Exec(ctx)
	return err
}

// GetKeyInfo 從 Redis 取 API Key 快取資訊
func (c *QuotaCache) GetKeyInfo(ctx context.Context, hash string) (map[string]string, error) {
	return c.rdb.HGetAll(ctx, keyInfoKey(hash)).Result()
}

// InvalidateKeyInfo 清除 API Key 快取（revoke 時呼叫）
func (c *QuotaCache) InvalidateKeyInfo(ctx context.Context, hash string) error {
	return c.rdb.Del(ctx, keyInfoKey(hash)).Err()
}

// ─── RPM 計數 ─────────────────────────────────────────────────

// IncrRPM 遞增 RPM 計數，回傳目前計數
func (c *QuotaCache) IncrRPM(ctx context.Context, keyID, apiID string) (int64, error) {
	k := rpmKey(keyID, apiID)
	pipe := c.rdb.Pipeline()
	incrCmd := pipe.Incr(ctx, k)
	pipe.Expire(ctx, k, 60*time.Second)
	if _, err := pipe.Exec(ctx); err != nil {
		return 0, err
	}
	return incrCmd.Val(), nil
}

func (c *QuotaCache) GetRPM(ctx context.Context, keyID, apiID string) (int64, error) {
	v, err := c.rdb.Get(ctx, rpmKey(keyID, apiID)).Int64()
	if err == redis.Nil {
		return 0, nil
	}
	return v, err
}

// ─── 每日計數 ─────────────────────────────────────────────────

// IncrDaily 遞增今日計數，回傳目前計數；TTL 25 小時確保跨日歸零
func (c *QuotaCache) IncrDaily(ctx context.Context, keyID, apiID string) (int64, error) {
	k := dailyKey(keyID, apiID)
	pipe := c.rdb.Pipeline()
	incrCmd := pipe.Incr(ctx, k)
	pipe.Expire(ctx, k, 25*time.Hour)
	if _, err := pipe.Exec(ctx); err != nil {
		return 0, err
	}
	return incrCmd.Val(), nil
}

func (c *QuotaCache) GetDaily(ctx context.Context, keyID, apiID string) (int64, error) {
	v, err := c.rdb.Get(ctx, dailyKey(keyID, apiID)).Int64()
	if err == redis.Nil {
		return 0, nil
	}
	return v, err
}

// SetDailyBase 初始化今日計數（從 PostgreSQL 載入），避免重啟後遺失
func (c *QuotaCache) SetDailyBase(ctx context.Context, keyID, apiID string, count int64) error {
	k := dailyKey(keyID, apiID)
	exists, _ := c.rdb.Exists(ctx, k).Result()
	if exists == 0 && count > 0 {
		c.rdb.Set(ctx, k, count, 25*time.Hour) //nolint:errcheck
	}
	return nil
}

// ─── key helpers ─────────────────────────────────────────────

func keyInfoKey(hash string) string {
	return fmt.Sprintf("apikey:info:%s", hash)
}

func rpmKey(keyID, apiID string) string {
	return fmt.Sprintf("quota:rpm:%s:%s", keyID, apiID)
}

func dailyKey(keyID, apiID string) string {
	date := time.Now().Format("2006-01-02")
	return fmt.Sprintf("quota:day:%s:%s:%s", keyID, apiID, date)
}
