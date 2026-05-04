package plugins

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/xcloudapim/policy-engine/internal/domain"
)

// CircuitBreakerPlugin 熔斷器（closed → open → half_open）
// 狀態持久化於 Redis，支援分散式多節點共享
//
// config keys:
//   threshold       = "5"     (連續失敗 N 次後開啟熔斷，預設 5)
//   timeout         = "30"    (open → half_open 等待秒數，預設 30)
//   half_open_max   = "2"     (half_open 允許通過的探測請求數，預設 2)
//   window          = "60"    (計算錯誤率的滑動窗口秒數，預設 60)
//   error_threshold = "50"    (窗口內錯誤率 % 超過此值觸發熔斷，預設 50)
type CircuitBreakerPlugin struct {
	rdb *redis.Client
}

func NewCircuitBreakerPlugin(rdb *redis.Client) *CircuitBreakerPlugin {
	return &CircuitBreakerPlugin{rdb: rdb}
}

func (p *CircuitBreakerPlugin) Type() domain.PolicyType { return domain.PolicyTypeCircuitBreaker }

func (p *CircuitBreakerPlugin) Validate(config map[string]string) []string {
	var errs []string
	for _, key := range []string{"threshold", "timeout", "half_open_max", "window", "error_threshold"} {
		if v := cfgGet(config, key); v != "" {
			if n, err := strconv.Atoi(v); err != nil || n <= 0 {
				errs = append(errs, key+" must be a positive integer")
			}
		}
	}
	return errs
}

func (p *CircuitBreakerPlugin) Execute(ctx context.Context, execCtx *domain.ExecContext, config map[string]string) error {
	threshold, _     := strconv.Atoi(cfgGetDefault(config, "threshold", "5"))
	timeoutSec, _    := strconv.Atoi(cfgGetDefault(config, "timeout", "30"))
	halfOpenMax, _   := strconv.Atoi(cfgGetDefault(config, "half_open_max", "2"))
	windowSec, _     := strconv.Atoi(cfgGetDefault(config, "window", "60"))
	errThreshold, _  := strconv.Atoi(cfgGetDefault(config, "error_threshold", "50"))

	if threshold <= 0    { threshold = 5 }
	if timeoutSec <= 0   { timeoutSec = 30 }
	if halfOpenMax <= 0  { halfOpenMax = 2 }
	if windowSec <= 0    { windowSec = 60 }
	if errThreshold <= 0 { errThreshold = 50 }

	stateKey   := fmt.Sprintf("cb:state:%s", execCtx.APIID)
	openAtKey  := fmt.Sprintf("cb:open_at:%s", execCtx.APIID)
	failKey    := fmt.Sprintf("cb:fail:%s", execCtx.APIID)
	totalKey   := fmt.Sprintf("cb:total:%s", execCtx.APIID)
	halfKey    := fmt.Sprintf("cb:half:%s", execCtx.APIID)

	state := p.getState(ctx, stateKey)

	switch state {
	case domain.CBStateOpen:
		// 檢查是否到達 timeout，可轉換為 half_open
		openAtStr, _ := p.rdb.Get(ctx, openAtKey).Result()
		openAt, _ := strconv.ParseInt(openAtStr, 10, 64)
		if time.Now().Unix()-openAt >= int64(timeoutSec) {
			p.rdb.Set(ctx, stateKey, string(domain.CBStateHalfOpen), 0)
			p.rdb.Del(ctx, halfKey)
			// 允許第一個探測請求通過
			execCtx.SetRequestHeader("X-Circuit-Breaker", "half_open")
			return nil
		}
		execCtx.Abort(503, "circuit breaker open: service unavailable")
		return nil

	case domain.CBStateHalfOpen:
		// 限制探測請求數
		count, _ := p.rdb.Incr(ctx, halfKey).Result()
		p.rdb.Expire(ctx, halfKey, time.Duration(timeoutSec)*time.Second)
		if int(count) > halfOpenMax {
			execCtx.Abort(503, "circuit breaker half-open: probe limit reached")
			return nil
		}
		execCtx.SetRequestHeader("X-Circuit-Breaker", "half_open_probe")
		return nil

	default: // closed
		// ─── pre_request：檢查錯誤率 ──────────────────────
		if execCtx.StatusCode == 0 {
			// 尚未到 post_response，先放行
			return nil
		}
		// ─── post_response：記錄結果 ──────────────────────
		p.rdb.Incr(ctx, totalKey)
		p.rdb.Expire(ctx, totalKey, time.Duration(windowSec)*time.Second)

		isError := execCtx.StatusCode >= 500
		if isError {
			fails, _ := p.rdb.Incr(ctx, failKey).Result()
			p.rdb.Expire(ctx, failKey, time.Duration(windowSec)*time.Second)

			total, _ := p.rdb.Get(ctx, totalKey).Int64()
			failRate := 0
			if total > 0 {
				failRate = int(fails * 100 / total)
			}

			if int(fails) >= threshold || failRate >= errThreshold {
				p.rdb.Set(ctx, stateKey, string(domain.CBStateOpen), 0)
				p.rdb.Set(ctx, openAtKey, strconv.FormatInt(time.Now().Unix(), 10), 0)
				p.rdb.Del(ctx, failKey, totalKey)
			}
		} else if execCtx.GetHeader("X-Circuit-Breaker") == "half_open_probe" {
			// 探測成功 → 重置為 closed
			p.rdb.Set(ctx, stateKey, string(domain.CBStateClosed), 0)
			p.rdb.Del(ctx, failKey, totalKey, halfKey, openAtKey)
		}
	}

	return nil
}

func (p *CircuitBreakerPlugin) getState(ctx context.Context, key string) domain.CBState {
	val, err := p.rdb.Get(ctx, key).Result()
	if err != nil {
		return domain.CBStateClosed
	}
	switch domain.CBState(val) {
	case domain.CBStateOpen, domain.CBStateHalfOpen:
		return domain.CBState(val)
	default:
		return domain.CBStateClosed
	}
}
