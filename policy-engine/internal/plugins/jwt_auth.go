package plugins

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/xcloudapim/policy-engine/internal/domain"
)

// JWTAuthPlugin 驗證 Bearer JWT Token (RS256)
// 支援 JWKS 動態取得公鑰、kid 路由、scope 驗證、Claims 注入
type JWTAuthPlugin struct {
	jwksURL  string
	cacheTTL time.Duration
	mu       sync.RWMutex
	keys     map[string]*rsa.PublicKey
	cachedAt time.Time
}

func NewJWTAuthPlugin(jwksURL string, cacheTTL time.Duration) *JWTAuthPlugin {
	return &JWTAuthPlugin{
		jwksURL:  jwksURL,
		cacheTTL: cacheTTL,
		keys:     make(map[string]*rsa.PublicKey),
	}
}

func (p *JWTAuthPlugin) Type() domain.PolicyType { return domain.PolicyTypeJWTAuth }

func (p *JWTAuthPlugin) Validate(config map[string]string) []string {
	var errs []string
	alg := cfgGetDefault(config, "algorithm", "RS256")
	if alg != "RS256" && alg != "HS256" && alg != "ES256" {
		errs = append(errs, "algorithm must be RS256, HS256, or ES256")
	}
	return errs
}

func (p *JWTAuthPlugin) Execute(ctx context.Context, execCtx *domain.ExecContext, config map[string]string) error {
	// 取 Authorization header（大小寫不敏感）
	authHeader := execCtx.GetHeader("Authorization")
	if authHeader == "" {
		authHeader = execCtx.GetHeader("authorization")
	}
	if authHeader == "" || !strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
		execCtx.Abort(401, "missing or invalid Authorization header")
		return nil
	}
	tokenStr := strings.TrimSpace(authHeader[7:])

	// 從 Header 取 kid
	kid, err := extractKID(tokenStr)
	if err != nil {
		execCtx.Abort(401, "invalid JWT header")
		return nil
	}

	// 取公鑰（含本地快取）
	pubKey, err := p.getPublicKey(ctx, kid)
	if err != nil {
		execCtx.Abort(401, "unable to resolve JWT signing key")
		return nil
	}

	// 驗證簽章 + exp
	claims, err := verifyRS256JWT(tokenStr, pubKey)
	if err != nil {
		execCtx.Abort(401, "JWT verification failed: "+err.Error())
		return nil
	}

	// 驗證 issuer（可選）
	if issuer := cfgGet(config, "issuer"); issuer != "" {
		if iss, _ := claims["iss"].(string); iss != issuer {
			execCtx.Abort(401, "invalid token issuer")
			return nil
		}
	}

	// 驗證 audience（可選）
	if audience := cfgGet(config, "audience"); audience != "" {
		if !audienceContains(claims["aud"], audience) {
			execCtx.Abort(401, "invalid token audience")
			return nil
		}
	}

	// 驗證 required_scopes（空格分隔列表）
	if reqScopes := cfgGet(config, "required_scopes"); reqScopes != "" {
		tokenScopes := extractScopes(claims)
		for _, req := range strings.Fields(reqScopes) {
			if !containsStr(tokenScopes, req) {
				execCtx.Abort(403, "insufficient scope: "+req)
				return nil
			}
		}
	}

	// 注入 Claims 至 ExecContext
	for k, v := range claims {
		execCtx.Claims[k] = v
	}
	if cid, _ := claims["client_id"].(string); cid != "" {
		execCtx.ClientID = cid
		execCtx.SetRequestHeader("X-Client-ID", cid)
	}
	if plan, _ := claims["plan"].(string); plan != "" {
		execCtx.Plan = plan
	}
	if sub, _ := claims["sub"].(string); sub != "" {
		execCtx.SetRequestHeader("X-User-ID", sub)
	}

	return nil
}

// ─── JWKS 快取管理 ────────────────────────────────────────────

func (p *JWTAuthPlugin) getPublicKey(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	p.mu.RLock()
	if key, ok := p.keys[kid]; ok && time.Since(p.cachedAt) < p.cacheTTL {
		p.mu.RUnlock()
		return key, nil
	}
	p.mu.RUnlock()

	p.mu.Lock()
	defer p.mu.Unlock()

	// Double-check after write lock
	if key, ok := p.keys[kid]; ok && time.Since(p.cachedAt) < p.cacheTTL {
		return key, nil
	}

	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, p.jwksURL, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch JWKS from %s: %w", p.jwksURL, err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var jwks struct {
		Keys []struct {
			KID string `json:"kid"`
			KTY string `json:"kty"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if err := json.Unmarshal(body, &jwks); err != nil {
		return nil, fmt.Errorf("parse JWKS: %w", err)
	}

	newKeys := make(map[string]*rsa.PublicKey, len(jwks.Keys))
	for _, k := range jwks.Keys {
		if k.KTY != "RSA" || k.N == "" {
			continue
		}
		pub, err := jwkRSAPublicKey(k.N, k.E)
		if err == nil {
			newKeys[k.KID] = pub
		}
	}
	p.keys = newKeys
	p.cachedAt = time.Now()

	key, ok := p.keys[kid]
	if !ok {
		return nil, fmt.Errorf("kid '%s' not found in JWKS", kid)
	}
	return key, nil
}

// ─── JWT 驗證邏輯 ─────────────────────────────────────────────

func extractKID(tokenStr string) (string, error) {
	parts := strings.SplitN(tokenStr, ".", 3)
	if len(parts) != 3 {
		return "", fmt.Errorf("not a JWT")
	}
	headerJSON, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", err
	}
	var hdr struct {
		Kid string `json:"kid"`
	}
	json.Unmarshal(headerJSON, &hdr) //nolint:errcheck
	return hdr.Kid, nil
}

func verifyRS256JWT(tokenStr string, pub *rsa.PublicKey) (map[string]interface{}, error) {
	parts := strings.SplitN(tokenStr, ".", 3)
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid JWT")
	}

	// 驗證簽章
	signingInput := []byte(parts[0] + "." + parts[1])
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, fmt.Errorf("decode sig: %w", err)
	}
	digest := sha256.Sum256(signingInput)
	if err := rsa.VerifyPKCS1v15(pub, crypto.SHA256, digest[:], sig); err != nil {
		return nil, fmt.Errorf("invalid signature")
	}

	// 解析 Payload
	payloadJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, err
	}
	var claims map[string]interface{}
	if err := json.Unmarshal(payloadJSON, &claims); err != nil {
		return nil, err
	}

	// 驗證 exp
	if exp, ok := claims["exp"].(float64); ok {
		if time.Now().Unix() > int64(exp) {
			return nil, fmt.Errorf("token expired")
		}
	}
	return claims, nil
}

func jwkRSAPublicKey(nB64, eB64 string) (*rsa.PublicKey, error) {
	nb, err := base64.RawURLEncoding.DecodeString(nB64)
	if err != nil {
		return nil, err
	}
	eb, err := base64.RawURLEncoding.DecodeString(eB64)
	if err != nil {
		return nil, err
	}
	return &rsa.PublicKey{
		N: new(big.Int).SetBytes(nb),
		E: int(new(big.Int).SetBytes(eb).Int64()),
	}, nil
}

func audienceContains(aud interface{}, target string) bool {
	switch v := aud.(type) {
	case string:
		return v == target
	case []interface{}:
		for _, a := range v {
			if s, _ := a.(string); s == target {
				return true
			}
		}
	}
	return false
}

func extractScopes(claims map[string]interface{}) []string {
	raw := claims["scopes"]
	if raw == nil {
		raw = claims["scope"]
	}
	switch v := raw.(type) {
	case []interface{}:
		out := make([]string, 0, len(v))
		for _, s := range v {
			if str, ok := s.(string); ok {
				out = append(out, str)
			}
		}
		return out
	case string:
		return strings.Fields(v)
	}
	return nil
}

func containsStr(list []string, target string) bool {
	for _, s := range list {
		if s == target {
			return true
		}
	}
	return false
}
