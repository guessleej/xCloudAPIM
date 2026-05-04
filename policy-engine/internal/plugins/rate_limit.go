package plugins

import (
	"context"
	cryptorand "crypto/rand"
	"fmt"
	"math"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/xcloudapim/policy-engine/internal/domain"
)

var cryptoRandRead = cryptorand.Read

// ─── Lua Scripts ─────────────────────────────────────────────

// slidingWindowLua — Sorted Set Sliding Window（與 TypeScript 版完全一致）
// KEYS[1]: key  ARGV[1]: window_ms  ARGV[2]: limit  ARGV[3]: now_ms  ARGV[4]: request_id
// Returns: {current, limit, window_ms, allowed(1/0), oldest_ms}
const slidingWindowLua = `
local key          = KEYS[1]
local window_ms    = tonumber(ARGV[1])
local limit        = tonumber(ARGV[2])
local now_ms       = tonumber(ARGV[3])
local request_id   = ARGV[4]
local window_start = now_ms - window_ms
redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)
local current = redis.call('ZCARD', key)
local oldest  = 0
if current < limit then
  redis.call('ZADD', key, now_ms, request_id)
  redis.call('PEXPIRE', key, window_ms * 2)
  return {current + 1, limit, window_ms, 1, oldest}
else
  local e = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  if #e >= 2 then oldest = tonumber(e[2]) end
  return {current, limit, window_ms, 0, oldest}
end
`

// fixedWindowLua — INCR + EXPIRE Fixed Window
// KEYS[1]: key（含窗口 ID）  ARGV[1]: limit  ARGV[2]: window_ttl_s
// Returns: {current, limit, allowed(1/0), ttl_remaining_s}
const fixedWindowLua = `
local key   = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl_s = tonumber(ARGV[2])
local current = tonumber(redis.call('INCR', key))
if current == 1 then redis.call('EXPIRE', key, ttl_s) end
local ttl_rem = redis.call('TTL', key)
if current <= limit then return {current, limit, 1, ttl_rem}
else return {current, limit, 0, ttl_rem} end
`

// tokenBucketLua — Hash-based Token Bucket（允許 burst）
// KEYS[1]: bucket_key
// ARGV[1]: capacity  ARGV[2]: refill_rate(tokens/sec)  ARGV[3]: requested  ARGV[4]: now_ms
// Returns: {tokens_remaining, capacity, allowed(1/0), wait_ms}
const tokenBucketLua = `
local key         = KEYS[1]
local capacity    = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local requested   = tonumber(ARGV[3])
local now_ms      = tonumber(ARGV[4])
local data = redis.call('HMGET', key, 'tokens', 'last_ms')
local tokens  = tonumber(data[1]) or capacity
local last_ms = tonumber(data[2]) or now_ms
local elapsed = (now_ms - last_ms) / 1000
tokens = math.min(capacity, tokens + elapsed * refill_rate)
local wait_ms = 0
if tokens >= requested then
  tokens = tokens - requested
  redis.call('HMSET', key, 'tokens', tokens, 'last_ms', now_ms)
  redis.call('PEXPIRE', key, math.ceil(capacity / refill_rate) * 2000)
  return {math.floor(tokens), capacity, 1, 0}
else
  wait_ms = math.ceil((requested - tokens) / refill_rate * 1000)
  redis.call('HMSET', key, 'tokens', tokens, 'last_ms', now_ms)
  redis.call('PEXPIRE', key, math.ceil(capacity / refill_rate) * 2000)
  return {math.floor(tokens), capacity, 0, wait_ms}
end
`

// ─── Plugin ───────────────────────────────────────────────────

// RateLimitPlugin 多層速率限制（IP / ClientID / UserID）
// config keys:
//   strategy       = "sliding_window" | "fixed_window" | "token_bucket"  (預設 sliding_window)
//   key_by         = "client_id" | "ip" | "user_id"  (預設 client_id)
//   rpm            = "1000"
//   rph            = "5000"   (可選)
//   rpd            = "10000"  (可選)
//   burst_size     = "200"    (token_bucket 桶容量)
//   refill_rate    = "16.67"  (token_bucket tokens/sec，預設 rpm/60)
type RateLimitPlugin struct {
	rdb *redis.Client
}

func NewRateLimitPlugin(rdb *redis.Client) *RateLimitPlugin {
	return &RateLimitPlugin{rdb: rdb}
}

func (p *RateLimitPlugin) Type() domain.PolicyType { return domain.PolicyTypeRateLimit }

func (p *RateLimitPlugin) Validate(config map[string]string) []string {
	var errs []string
	if cfgGet(config, "rpm") == "" && cfgGet(config, "rph") == "" && cfgGet(config, "rpd") == "" {
		errs = append(errs, "at least one of rpm, rph, or rpd must be set")
	}
	strategy := cfgGetDefault(config, "strategy", "sliding_window")
	validStrategies := map[string]bool{"sliding_window": true, "fixed_window": true, "token_bucket": true}
	if !validStrategies[strategy] {
		errs = append(errs, "strategy must be sliding_window, fixed_window, or token_bucket")
	}
	keyBy := cfgGetDefault(config, "key_by", "client_id")
	if keyBy != "client_id" && keyBy != "ip" && keyBy != "user_id" {
		errs = append(errs, "key_by must be client_id, ip, or user_id")
	}
	return errs
}

func (p *RateLimitPlugin) Execute(ctx context.Context, execCtx *domain.ExecContext, config map[string]string) error {
	strategy := cfgGetDefault(config, "strategy", "sliding_window")
	keyBy    := cfgGetDefault(config, "key_by", "client_id")
	keyValue := p.resolveKey(execCtx, keyBy)
	apiID    := execCtx.APIID

	switch strategy {
	case "token_bucket":
		return p.executeTokenBucket(ctx, execCtx, config, keyValue, apiID)
	case "fixed_window":
		return p.executeFixed(ctx, execCtx, config, keyValue, apiID)
	default:
		return p.executeSliding(ctx, execCtx, config, keyValue, apiID)
	}
}

// ─── Sliding Window ───────────────────────────────────────────

func (p *RateLimitPlugin) executeSliding(ctx context.Context, execCtx *domain.ExecContext, config map[string]string, keyValue, apiID string) error {
	type windowCfg struct {
		period    string
		configKey string
		windowMS  int
		retryAfter string
		headerSuffix string
	}

	windows := []windowCfg{
		{"rpm", "rpm", 60_000,        "60",    "Minute"},
		{"rph", "rph", 3_600_000,     "3600",  "Hour"},
		{"rpd", "rpd", 86_400_000,    "86400", "Day"},
	}

	for _, w := range windows {
		limStr := cfgGet(config, w.configKey)
		if limStr == "" {
			continue
		}
		lim, _ := strconv.ParseInt(limStr, 10, 64)
		if lim <= 0 {
			continue
		}

		allowed, current, resetAt, err := p.slidingCheck(ctx, keyValue, apiID, w.period, w.windowMS, int(lim))
		if err != nil {
			return nil // fail-open
		}

		execCtx.SetResponseHeader("X-RateLimit-Limit-"+w.headerSuffix, strconv.FormatInt(lim, 10))
		execCtx.SetResponseHeader("X-RateLimit-Remaining-"+w.headerSuffix, strconv.Itoa(maxInt(0, int(lim)-current)))

		// RFC draft RateLimit headers（以最嚴格窗口為主）
		remaining := maxInt(0, int(lim)-current)
		execCtx.SetResponseHeader("RateLimit-Limit",     fmt.Sprintf("%d;w=%d", lim, w.windowMS/1000))
		execCtx.SetResponseHeader("RateLimit-Remaining", strconv.Itoa(remaining))
		if resetAt > 0 {
			resetSec := maxInt(0, int((resetAt-time.Now().UnixMilli())/1000))
			execCtx.SetResponseHeader("RateLimit-Reset", strconv.Itoa(resetSec))
		}

		if !allowed {
			execCtx.SetResponseHeader("Retry-After", w.retryAfter)
			execCtx.Abort(429, fmt.Sprintf("rate limit exceeded: %d requests per %s", lim, w.period))
			return nil
		}
	}
	return nil
}

func (p *RateLimitPlugin) slidingCheck(ctx context.Context, keyValue, apiID, period string, windowMS, limit int) (allowed bool, current int, resetAtMs int64, err error) {
	redisKey := fmt.Sprintf("rl:sw:%s:%s:%s", period, keyValue, apiID)
	nowMS    := time.Now().UnixMilli()
	reqID    := fmt.Sprintf("%d-%s", nowMS, execRandHex(8))

	result, evalErr := p.rdb.Eval(ctx, slidingWindowLua,
		[]string{redisKey},
		windowMS, limit, nowMS, reqID,
	).Slice()
	if evalErr != nil {
		return true, 0, 0, evalErr
	}

	cur, _     := result[0].(int64)
	allow, _   := result[3].(int64)
	oldest, _  := result[4].(int64)

	resetAt := int64(0)
	if oldest > 0 {
		resetAt = oldest + int64(windowMS)
	} else {
		resetAt = nowMS + int64(windowMS)
	}
	return allow == 1, int(cur), resetAt, nil
}

// ─── Fixed Window ─────────────────────────────────────────────

func (p *RateLimitPlugin) executeFixed(ctx context.Context, execCtx *domain.ExecContext, config map[string]string, keyValue, apiID string) error {
	type windowCfg struct {
		period     string
		configKey  string
		windowSec  int
		retryAfter string
		headerSfx  string
	}

	windows := []windowCfg{
		{"rpm", "rpm", 60,    "60",    "Minute"},
		{"rph", "rph", 3600,  "3600",  "Hour"},
		{"rpd", "rpd", 86400, "86400", "Day"},
	}

	for _, w := range windows {
		limStr := cfgGet(config, w.configKey)
		if limStr == "" {
			continue
		}
		lim, _ := strconv.ParseInt(limStr, 10, 64)
		if lim <= 0 {
			continue
		}

		windowID := time.Now().Unix() / int64(w.windowSec)
		redisKey := fmt.Sprintf("rl:fw:%s:%s:%s:%d", w.period, keyValue, apiID, windowID)

		result, err := p.rdb.Eval(ctx, fixedWindowLua,
			[]string{redisKey},
			lim, w.windowSec,
		).Slice()
		if err != nil {
			return nil
		}

		current, _ := result[0].(int64)
		allowed, _ := result[2].(int64)
		ttl, _     := result[3].(int64)

		execCtx.SetResponseHeader("X-RateLimit-Limit-"+w.headerSfx, strconv.FormatInt(lim, 10))
		execCtx.SetResponseHeader("X-RateLimit-Remaining-"+w.headerSfx, strconv.Itoa(maxInt(0, int(lim)-int(current))))
		execCtx.SetResponseHeader("RateLimit-Reset", strconv.FormatInt(ttl, 10))

		if allowed != 1 {
			execCtx.SetResponseHeader("Retry-After", strconv.FormatInt(ttl, 10))
			execCtx.Abort(429, fmt.Sprintf("rate limit exceeded: %d requests per %s", lim, w.period))
			return nil
		}
	}
	return nil
}

// ─── Token Bucket ─────────────────────────────────────────────

func (p *RateLimitPlugin) executeTokenBucket(ctx context.Context, execCtx *domain.ExecContext, config map[string]string, keyValue, apiID string) error {
	rpm, _ := strconv.ParseFloat(cfgGetDefault(config, "rpm", "100"), 64)

	capacity   := float64(0)
	if bs := cfgGet(config, "burst_size"); bs != "" {
		capacity, _ = strconv.ParseFloat(bs, 64)
	}
	if capacity <= 0 {
		capacity = math.Ceil(rpm * 1.5)
	}

	refillRate := float64(0)
	if rr := cfgGet(config, "refill_rate"); rr != "" {
		refillRate, _ = strconv.ParseFloat(rr, 64)
	}
	if refillRate <= 0 {
		refillRate = rpm / 60.0
	}

	redisKey := fmt.Sprintf("rl:tb:%s:%s", keyValue, apiID)
	nowMS    := time.Now().UnixMilli()

	result, err := p.rdb.Eval(ctx, tokenBucketLua,
		[]string{redisKey},
		capacity, refillRate, 1, nowMS,
	).Slice()
	if err != nil {
		return nil // fail-open
	}

	tokens, _  := result[0].(int64)
	cap, _     := result[1].(int64)
	allowed, _ := result[2].(int64)
	waitMs, _  := result[3].(int64)

	execCtx.SetResponseHeader("X-RateLimit-Limit-Minute",     strconv.FormatInt(cap, 10))
	execCtx.SetResponseHeader("X-RateLimit-Remaining-Minute", strconv.FormatInt(maxInt64(0, tokens), 10))

	if allowed != 1 {
		retrySec := maxInt(1, int(waitMs/1000))
		execCtx.SetResponseHeader("Retry-After", strconv.Itoa(retrySec))
		execCtx.Abort(429, "rate limit exceeded (token bucket)")
	}
	return nil
}

// ─── helpers ─────────────────────────────────────────────────

func (p *RateLimitPlugin) resolveKey(execCtx *domain.ExecContext, keyBy string) string {
	switch keyBy {
	case "ip":
		return execCtx.RemoteIP
	case "user_id":
		if uid, _ := execCtx.Claims["sub"].(string); uid != "" {
			return uid
		}
		return execCtx.RemoteIP
	default:
		if execCtx.ClientID != "" {
			return execCtx.ClientID
		}
		return execCtx.RemoteIP
	}
}

func execRandHex(n int) string {
	b := make([]byte, n/2)
	if _, err := cryptoRandRead(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return fmt.Sprintf("%x", b)
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
