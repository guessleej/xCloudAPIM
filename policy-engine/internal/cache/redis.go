package cache

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

const (
	KeyPolicyChain   = "policy:chain:%s"       // api_id
	CacheInvalidateCh = "policy:invalidate"
)

type RedisCache struct {
	client *redis.Client
	logger *zap.Logger
}

func NewRedisCache(addr, password string, db int, logger *zap.Logger) (*RedisCache, error) {
	client := redis.NewClient(&redis.Options{
		Addr:         addr,
		Password:     password,
		DB:           db,
		DialTimeout:  5 * time.Second,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("redis ping: %w", err)
	}
	logger.Info("Redis connected")
	return &RedisCache{client: client, logger: logger}, nil
}

func (c *RedisCache) Close() error {
	return c.client.Close()
}

// Set caches serialised JSON for a chain identified by apiID.
func (c *RedisCache) Set(ctx context.Context, apiID string, data []byte, ttl time.Duration) error {
	key := fmt.Sprintf(KeyPolicyChain, apiID)
	return c.client.Set(ctx, key, data, ttl).Err()
}

// Get retrieves a cached chain. Returns nil, nil when not found.
func (c *RedisCache) Get(ctx context.Context, apiID string) ([]byte, error) {
	key := fmt.Sprintf(KeyPolicyChain, apiID)
	val, err := c.client.Get(ctx, key).Bytes()
	if err != nil {
		if err == redis.Nil {
			return nil, nil
		}
		return nil, err
	}
	return val, nil
}

// Invalidate removes the cached chain and publishes an invalidation event
// so that the gateway's in-process cache is also cleared.
func (c *RedisCache) Invalidate(ctx context.Context, apiID string) error {
	key := fmt.Sprintf(KeyPolicyChain, apiID)
	if err := c.client.Del(ctx, key).Err(); err != nil {
		c.logger.Warn("redis del failed", zap.String("key", key), zap.Error(err))
	}
	// Pub/Sub: gateway subscribes to this channel and clears its chainCache map
	if err := c.client.Publish(ctx, CacheInvalidateCh, apiID).Err(); err != nil {
		c.logger.Warn("publish invalidation failed", zap.Error(err))
	}
	return nil
}
