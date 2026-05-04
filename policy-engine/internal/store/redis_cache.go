package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/xcloudapim/policy-engine/internal/domain"
)

const chainCacheTTL = 5 * time.Minute

// ChainCache PolicyChain 的 Redis 二級快取（減少 PostgreSQL 負載）
type ChainCache struct {
	rdb *redis.Client
}

func NewChainCache(rdb *redis.Client) *ChainCache {
	return &ChainCache{rdb: rdb}
}

func (c *ChainCache) Get(ctx context.Context, apiID string) (*domain.PolicyChain, error) {
	key := chainKey(apiID)
	data, err := c.rdb.Get(ctx, key).Bytes()
	if err != nil {
		return nil, err // redis.Nil 或其他錯誤
	}

	var chain domain.PolicyChain
	if err := json.Unmarshal(data, &chain); err != nil {
		return nil, err
	}
	return &chain, nil
}

func (c *ChainCache) Set(ctx context.Context, chain *domain.PolicyChain) error {
	data, err := json.Marshal(chain)
	if err != nil {
		return err
	}
	return c.rdb.Set(ctx, chainKey(chain.APIID), data, chainCacheTTL).Err()
}

// Invalidate 清除指定 API 的快取（Policy 更新後呼叫）
func (c *ChainCache) Invalidate(ctx context.Context, apiID string) error {
	return c.rdb.Del(ctx, chainKey(apiID)).Err()
}

// InvalidateAll 清除所有 chain 快取（重新部署時）
func (c *ChainCache) InvalidateAll(ctx context.Context) error {
	iter := c.rdb.Scan(ctx, 0, "chain:*", 100).Iterator()
	var keys []string
	for iter.Next(ctx) {
		keys = append(keys, iter.Val())
	}
	if err := iter.Err(); err != nil {
		return err
	}
	if len(keys) == 0 {
		return nil
	}
	return c.rdb.Del(ctx, keys...).Err()
}

// ─── ChainRepository 合併 PostgreSQL + Redis ──────────────────

// ChainRepository 讀取時先查 Redis，Miss 再查 PostgreSQL 並回填
type ChainRepository struct {
	store *ChainStore
	cache *ChainCache
}

func NewChainRepository(store *ChainStore, cache *ChainCache) *ChainRepository {
	return &ChainRepository{store: store, cache: cache}
}

func (r *ChainRepository) GetByAPIID(ctx context.Context, apiID string) (*domain.PolicyChain, error) {
	// L1: Redis
	if chain, err := r.cache.Get(ctx, apiID); err == nil {
		return chain, nil
	}

	// L2: PostgreSQL
	chain, err := r.store.GetByAPIID(ctx, apiID)
	if err != nil {
		return nil, err
	}

	// 回填 Redis（忽略錯誤）
	_ = r.cache.Set(ctx, chain)
	return chain, nil
}

func (r *ChainRepository) SaveAndPublish(ctx context.Context, chain *domain.PolicyChain) error {
	if err := r.store.SaveVersion(ctx, chain); err != nil {
		return err
	}
	return r.cache.Invalidate(ctx, chain.APIID)
}

func (r *ChainRepository) InvalidateCache(ctx context.Context, apiID string) error {
	return r.cache.Invalidate(ctx, apiID)
}

func chainKey(apiID string) string {
	return fmt.Sprintf("chain:%s", apiID)
}
