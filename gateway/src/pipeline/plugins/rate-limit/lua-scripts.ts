/**
 * Redis Lua 腳本集合
 * 所有腳本均為原子操作，保證分散式環境下的計數正確性。
 */

// ─── Sliding Window Counter ───────────────────────────────────
// 使用 Sorted Set，score = timestamp_ms
// KEYS[1] = 計數 key
// ARGV[1] = window_ms, ARGV[2] = limit, ARGV[3] = now_ms, ARGV[4] = request_id
// Returns: [current, limit, window_ms, allowed(1/0), oldest_ms_in_window]
export const SLIDING_WINDOW = `
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
  local oldest_entry = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  if #oldest_entry >= 2 then oldest = tonumber(oldest_entry[2]) end
  return {current, limit, window_ms, 0, oldest}
end
`

// ─── Fixed Window Counter ─────────────────────────────────────
// 使用 String + INCRBY，key 含時間窗口 ID 確保自動歸零
// KEYS[1] = 計數 key（含窗口 ID）
// ARGV[1] = limit, ARGV[2] = window_ttl_s
// Returns: [current, limit, allowed(1/0), ttl_s]
export const FIXED_WINDOW = `
local key     = KEYS[1]
local limit   = tonumber(ARGV[1])
local ttl_s   = tonumber(ARGV[2])

local current = tonumber(redis.call('INCR', key))
if current == 1 then
  redis.call('EXPIRE', key, ttl_s)
end

local ttl_remaining = redis.call('TTL', key)
if current <= limit then
  return {current, limit, 1, ttl_remaining}
else
  return {current, limit, 0, ttl_remaining}
end
`

// ─── Token Bucket ─────────────────────────────────────────────
// 使用 Hash 儲存 tokens 與 last_refill_ms
// KEYS[1] = bucket key
// ARGV[1] = capacity（桶容量）, ARGV[2] = refill_rate（tokens/sec）
// ARGV[3] = requested（本次消費 tokens，通常為 1）, ARGV[4] = now_ms
// Returns: [tokens_remaining, capacity, allowed(1/0), wait_ms]
export const TOKEN_BUCKET = `
local key          = KEYS[1]
local capacity     = tonumber(ARGV[1])
local refill_rate  = tonumber(ARGV[2])
local requested    = tonumber(ARGV[3])
local now_ms       = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'last_ms')
local tokens   = tonumber(data[1]) or capacity
local last_ms  = tonumber(data[2]) or now_ms

-- 補充 token（依經過時間計算）
local elapsed_s = (now_ms - last_ms) / 1000
local refilled  = elapsed_s * refill_rate
tokens = math.min(capacity, tokens + refilled)

local wait_ms = 0
if tokens >= requested then
  tokens = tokens - requested
  redis.call('HMSET', key, 'tokens', tokens, 'last_ms', now_ms)
  redis.call('PEXPIRE', key, math.ceil(capacity / refill_rate) * 2000)
  return {math.floor(tokens), capacity, 1, 0}
else
  -- 計算需等多少 ms 才有足夠 token
  wait_ms = math.ceil((requested - tokens) / refill_rate * 1000)
  redis.call('HMSET', key, 'tokens', tokens, 'last_ms', now_ms)
  redis.call('PEXPIRE', key, math.ceil(capacity / refill_rate) * 2000)
  return {math.floor(tokens), capacity, 0, wait_ms}
end
`
