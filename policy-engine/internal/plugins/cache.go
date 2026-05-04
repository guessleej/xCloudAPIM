package plugins

import (
	"context"
	"crypto/sha256"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/xcloudapim/policy-engine/internal/domain"
)

// CachePlugin Redis 回應快取
// config keys:
//   ttl        = "300"           (秒，預設 60)
//   key_by     = "path"          (path | path_method | path_method_client)
//   vary_headers = "Accept,Accept-Language"
//   bypass_if  = "no-cache"      (若請求含 Cache-Control: no-cache 則略過)
//   cacheable_methods = "GET,HEAD" (預設 GET,HEAD)
type CachePlugin struct {
	rdb *redis.Client
}

func NewCachePlugin(rdb *redis.Client) *CachePlugin {
	return &CachePlugin{rdb: rdb}
}

func (p *CachePlugin) Type() domain.PolicyType { return domain.PolicyTypeCache }

func (p *CachePlugin) Validate(config map[string]string) []string {
	var errs []string
	if ttl := cfgGet(config, "ttl"); ttl != "" {
		if v, err := strconv.Atoi(ttl); err != nil || v <= 0 {
			errs = append(errs, "ttl must be a positive integer (seconds)")
		}
	}
	return errs
}

func (p *CachePlugin) Execute(ctx context.Context, execCtx *domain.ExecContext, config map[string]string) error {
	// 只快取指定 HTTP 方法
	cacheableMethods := parseCSV(cfgGetDefault(config, "cacheable_methods", "GET,HEAD"))
	if !containsStr(cacheableMethods, execCtx.Method) {
		return nil
	}

	// bypass_if: Cache-Control: no-cache
	if cfgGet(config, "bypass_if") == "no-cache" {
		cc := strings.ToLower(execCtx.GetHeader("Cache-Control"))
		if strings.Contains(cc, "no-cache") || strings.Contains(cc, "no-store") {
			return nil
		}
	}

	ttlSec, _ := strconv.Atoi(cfgGetDefault(config, "ttl", "60"))
	if ttlSec <= 0 {
		ttlSec = 60
	}

	cacheKey := p.buildKey(execCtx, config)

	// ─── Phase: pre_request → 嘗試命中快取 ────────────────────
	if execCtx.ResponseBody == nil && !execCtx.CacheHit {
		cached, err := p.rdb.Get(ctx, cacheKey).Bytes()
		if err == nil {
			entry, parseErr := parseCacheEntry(cached)
			if parseErr == nil {
				execCtx.CacheHit = true
				execCtx.CachedBody = entry.Body
				execCtx.StatusCode = entry.Status
				for k, v := range entry.Headers {
					execCtx.SetResponseHeader(k, v)
				}
				execCtx.SetResponseHeader("X-Cache", "HIT")
				execCtx.Abort(entry.Status, "")
				return nil
			}
		}
		execCtx.SetResponseHeader("X-Cache", "MISS")
		return nil
	}

	// ─── Phase: post_response → 寫入快取 ──────────────────────
	if execCtx.StatusCode >= 200 && execCtx.StatusCode < 300 && len(execCtx.ResponseBody) > 0 {
		entry := &cacheEntry{
			Status:  execCtx.StatusCode,
			Body:    execCtx.ResponseBody,
			Headers: execCtx.ResponseHeaders,
		}
		if data, err := marshalCacheEntry(entry); err == nil {
			p.rdb.Set(ctx, cacheKey, data, time.Duration(ttlSec)*time.Second)
		}
	}

	return nil
}

func (p *CachePlugin) buildKey(execCtx *domain.ExecContext, config map[string]string) string {
	keyBy := cfgGetDefault(config, "key_by", "path")

	var parts []string
	parts = append(parts, "cache", execCtx.APIID, execCtx.Path)

	switch keyBy {
	case "path_method":
		parts = append(parts, execCtx.Method)
	case "path_method_client":
		parts = append(parts, execCtx.Method, execCtx.ClientID)
	}

	// vary_headers
	if varyHeaders := cfgGet(config, "vary_headers"); varyHeaders != "" {
		for _, h := range parseCSV(varyHeaders) {
			v := execCtx.GetHeader(h)
			if v != "" {
				parts = append(parts, h+"="+v)
			}
		}
	}

	raw := strings.Join(parts, ":")
	hash := sha256.Sum256([]byte(raw))
	return fmt.Sprintf("cache:%s:%x", execCtx.APIID, hash[:8])
}

// ─── Cache Entry 序列化（簡易格式） ───────────────────────────

type cacheEntry struct {
	Status  int
	Body    []byte
	Headers map[string]string
}

func marshalCacheEntry(e *cacheEntry) ([]byte, error) {
	// 格式: STATUS\nHEADER_K:HEADER_V\n...\n\nBODY
	var sb strings.Builder
	sb.WriteString(strconv.Itoa(e.Status))
	sb.WriteByte('\n')
	for k, v := range e.Headers {
		sb.WriteString(k)
		sb.WriteByte(':')
		sb.WriteString(v)
		sb.WriteByte('\n')
	}
	sb.WriteByte('\n')
	result := append([]byte(sb.String()), e.Body...)
	return result, nil
}

func parseCacheEntry(data []byte) (*cacheEntry, error) {
	idx := 0
	// 讀取 status
	nlIdx := indexOf(data, '\n', idx)
	if nlIdx < 0 {
		return nil, fmt.Errorf("invalid cache entry")
	}
	status, err := strconv.Atoi(string(data[idx:nlIdx]))
	if err != nil {
		return nil, err
	}
	idx = nlIdx + 1
	headers := make(map[string]string)
	// 讀取 headers 直到空行
	for idx < len(data) {
		nl := indexOf(data, '\n', idx)
		if nl < 0 {
			break
		}
		line := string(data[idx:nl])
		idx = nl + 1
		if line == "" {
			break // 空行：headers 結束
		}
		sep := strings.IndexByte(line, ':')
		if sep > 0 {
			headers[line[:sep]] = line[sep+1:]
		}
	}
	return &cacheEntry{Status: status, Body: data[idx:], Headers: headers}, nil
}

func indexOf(data []byte, b byte, from int) int {
	for i := from; i < len(data); i++ {
		if data[i] == b {
			return i
		}
	}
	return -1
}
