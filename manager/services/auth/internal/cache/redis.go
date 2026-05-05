package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

const (
	keyPrefixToken    = "auth:token:"
	keyPrefixRevoked  = "auth:revoked:"
	keyPrefixAuthCode = "auth:code:"
	keyPrefixClient   = "auth:client:"
	keyPrefixUser     = "auth:user:"
)

type RedisCache struct {
	rdb    *redis.Client
	logger *zap.Logger
}

func NewRedisCache(addr, password string, db int, logger *zap.Logger) (*RedisCache, error) {
	rdb := redis.NewClient(&redis.Options{
		Addr:         addr,
		Password:     password,
		DB:           db,
		DialTimeout:  5 * time.Second,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
		PoolSize:     20,
		MinIdleConns: 5,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("redis ping: %w", err)
	}

	logger.Info("Redis connected", zap.String("addr", addr))
	return &RedisCache{rdb: rdb, logger: logger}, nil
}

// ─── Token Cache ──────────────────────────────────────────────

// SetToken 快取 Token Claims（TTL = token 剩餘有效期）
func (c *RedisCache) SetToken(ctx context.Context, tokenHash string, claims interface{}, ttl time.Duration) error {
	data, err := json.Marshal(claims)
	if err != nil {
		return fmt.Errorf("marshal token claims: %w", err)
	}
	key := keyPrefixToken + tokenHash
	return c.rdb.Set(ctx, key, data, ttl).Err()
}

// GetToken 從快取取得 Token Claims
func (c *RedisCache) GetToken(ctx context.Context, tokenHash string, dest interface{}) (bool, error) {
	key := keyPrefixToken + tokenHash
	data, err := c.rdb.Get(ctx, key).Bytes()
	if err == redis.Nil {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("get token from cache: %w", err)
	}
	if err := json.Unmarshal(data, dest); err != nil {
		return false, fmt.Errorf("unmarshal token claims: %w", err)
	}
	return true, nil
}

// ─── Token Blacklist（撤銷清單） ───────────────────────────────

// RevokeToken 將 Token Hash 加入黑名單（TTL = token 剩餘有效期 + buffer）
func (c *RedisCache) RevokeToken(ctx context.Context, tokenHash string, ttl time.Duration) error {
	key := keyPrefixRevoked + tokenHash
	return c.rdb.Set(ctx, key, "1", ttl+time.Minute).Err()
}

// IsRevoked 檢查 Token 是否在黑名單中
func (c *RedisCache) IsRevoked(ctx context.Context, tokenHash string) (bool, error) {
	key := keyPrefixRevoked + tokenHash
	result, err := c.rdb.Exists(ctx, key).Result()
	if err != nil {
		return false, fmt.Errorf("check revoked: %w", err)
	}
	return result > 0, nil
}

// DeleteToken 同時清除快取與黑名單
func (c *RedisCache) DeleteToken(ctx context.Context, tokenHash string) error {
	keys := []string{keyPrefixToken + tokenHash}
	return c.rdb.Del(ctx, keys...).Err()
}

// ─── Authorization Code Cache ─────────────────────────────────

type AuthCodeCache struct {
	Code                string   `json:"code"`
	ClientID            string   `json:"client_id"`
	UserID              string   `json:"user_id"`
	RedirectURI         string   `json:"redirect_uri"`
	Scopes              []string `json:"scopes"`
	CodeChallenge       string   `json:"code_challenge"`
	CodeChallengeMethod string   `json:"code_challenge_method"`
	Nonce               string   `json:"nonce"`
}

func (c *RedisCache) SetAuthCode(ctx context.Context, code string, data *AuthCodeCache, ttl time.Duration) error {
	payload, err := json.Marshal(data)
	if err != nil {
		return err
	}
	key := keyPrefixAuthCode + code
	return c.rdb.Set(ctx, key, payload, ttl).Err()
}

func (c *RedisCache) GetAuthCode(ctx context.Context, code string) (*AuthCodeCache, error) {
	key := keyPrefixAuthCode + code
	data, err := c.rdb.Get(ctx, key).Bytes()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get auth code: %w", err)
	}
	var result AuthCodeCache
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// DeleteAuthCode 使用後立即刪除（防止重放攻擊）
func (c *RedisCache) DeleteAuthCode(ctx context.Context, code string) error {
	return c.rdb.Del(ctx, keyPrefixAuthCode+code).Err()
}

// ─── Client Info Cache ────────────────────────────────────────

type ClientCache struct {
	ClientID   string   `json:"client_id"`
	ClientName string   `json:"client_name"`
	Plan       string   `json:"plan"`
	Scopes     []string `json:"scopes"`
	Active     bool     `json:"active"`
	RPMLimit   int64    `json:"rpm_limit"`
	RPDLimit   int64    `json:"rpd_limit"`
}

func (c *RedisCache) SetClientInfo(ctx context.Context, clientID string, data *ClientCache) error {
	payload, err := json.Marshal(data)
	if err != nil {
		return err
	}
	key := keyPrefixClient + clientID
	return c.rdb.Set(ctx, key, payload, 5*time.Minute).Err()
}

func (c *RedisCache) GetClientInfo(ctx context.Context, clientID string) (*ClientCache, error) {
	key := keyPrefixClient + clientID
	data, err := c.rdb.Get(ctx, key).Bytes()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var result ClientCache
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// ─── Health Check ─────────────────────────────────────────────

func (c *RedisCache) Health(ctx context.Context) error {
	return c.rdb.Ping(ctx).Err()
}

func (c *RedisCache) Close() error {
	return c.rdb.Close()
}

// NewClient 複用連線設定，建立指向不同 DB 的獨立 client（用於 rate limit 等隔離需求）
func (c *RedisCache) NewClient(db int) *redis.Client {
	opt := c.rdb.Options()
	return redis.NewClient(&redis.Options{
		Addr:         opt.Addr,
		Password:     opt.Password,
		DB:           db,
		DialTimeout:  opt.DialTimeout,
		ReadTimeout:  opt.ReadTimeout,
		WriteTimeout: opt.WriteTimeout,
		PoolSize:     5,
		MinIdleConns: 1,
	})
}
