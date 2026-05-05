package service

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

// RateLimitStore 定義速率限制介面
type RateLimitStore interface {
	Allow(ctx context.Context, key string, maxRequests int) (bool, error)
}

// RedisRateLimitStore 使用 Redis 固定視窗速率限制（1 分鐘）
type RedisRateLimitStore struct {
	rdb    *redis.Client
	window time.Duration
}

func NewRedisRateLimitStore(rdb *redis.Client) *RedisRateLimitStore {
	return &RedisRateLimitStore{rdb: rdb, window: time.Minute}
}

func (s *RedisRateLimitStore) Allow(ctx context.Context, key string, maxRequests int) (bool, error) {
	pipe := s.rdb.Pipeline()
	incr := pipe.Incr(ctx, key)
	pipe.Expire(ctx, key, s.window)
	if _, err := pipe.Exec(ctx); err != nil {
		// Redis 故障時放行（fail-open），避免阻擋正常請求
		return true, err
	}
	return incr.Val() <= int64(maxRequests), nil
}
