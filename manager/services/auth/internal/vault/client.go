package vault

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"os"
	"sync"
	"time"

	"github.com/hashicorp/vault/api"
	"go.uber.org/zap"
)

type Client struct {
	vc            *api.Client
	jwtSecretPath string
	logger        *zap.Logger
	// 本地 Key Cache（避免每次請求都呼叫 Vault）
	mu         sync.RWMutex
	privateKey *rsa.PrivateKey
	publicKey  *rsa.PublicKey
	keyID      string
	cachedAt   time.Time
	cacheTTL   time.Duration
}

type JWTKeyPair struct {
	PrivateKey *rsa.PrivateKey
	PublicKey  *rsa.PublicKey
	KeyID      string
	Algorithm  string
}

func NewClient(addr, token, jwtSecretPath string, logger *zap.Logger) (*Client, error) {
	cfg := api.DefaultConfig()
	cfg.Address = addr

	vc, err := api.NewClient(cfg)
	if err != nil {
		return nil, fmt.Errorf("create vault client: %w", err)
	}

	c := &Client{
		vc:            vc,
		jwtSecretPath: jwtSecretPath,
		logger:        logger,
		cacheTTL:      5 * time.Minute,
	}
	c.vaultLogin(token)
	return c, nil
}

// vaultLogin 取得 token：有 VAULT_ROLE_ID/VAULT_SECRET_ID 走 AppRole（並背景續租），
// 否則用傳入的 static token；AppRole 失敗則 fallback static token（漸進遷移）。
func (c *Client) vaultLogin(staticToken string) {
	roleID := os.Getenv("VAULT_ROLE_ID")
	secretID := os.Getenv("VAULT_SECRET_ID")
	if roleID == "" || secretID == "" {
		c.vc.SetToken(staticToken)
		return
	}
	if err := c.appRoleLogin(roleID, secretID); err != nil {
		c.logger.Warn("AppRole login failed, falling back to VAULT_TOKEN", zap.Error(err))
		c.vc.SetToken(staticToken)
		return
	}
	go c.tokenRenewLoop(roleID, secretID)
}

func (c *Client) appRoleLogin(roleID, secretID string) error {
	sec, err := c.vc.Logical().Write("auth/approle/login", map[string]interface{}{
		"role_id": roleID, "secret_id": secretID,
	})
	if err != nil {
		return err
	}
	if sec == nil || sec.Auth == nil || sec.Auth.ClientToken == "" {
		return fmt.Errorf("approle login: empty token")
	}
	c.vc.SetToken(sec.Auth.ClientToken)
	c.logger.Info("vault AppRole login ok (jwt client)", zap.Int("token_ttl_s", sec.Auth.LeaseDuration))
	return nil
}

func (c *Client) tokenRenewLoop(roleID, secretID string) {
	t := time.NewTicker(30 * time.Minute)
	defer t.Stop()
	for range t.C {
		if _, err := c.vc.Auth().Token().RenewSelf(0); err != nil {
			c.logger.Warn("vault token renew-self failed, re-login", zap.Error(err))
			_ = c.appRoleLogin(roleID, secretID)
		}
	}
}

// GetJWTKeyPair 從 Vault 取得 JWT RSA Key Pair（含本地快取）
func (c *Client) GetJWTKeyPair() (*JWTKeyPair, error) {
	c.mu.RLock()
	if c.privateKey != nil && time.Since(c.cachedAt) < c.cacheTTL {
		pair := &JWTKeyPair{
			PrivateKey: c.privateKey,
			PublicKey:  c.publicKey,
			KeyID:      c.keyID,
			Algorithm:  "RS256",
		}
		c.mu.RUnlock()
		return pair, nil
	}
	c.mu.RUnlock()

	return c.fetchAndCacheKeys()
}

func (c *Client) fetchAndCacheKeys() (*JWTKeyPair, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Double-check after acquiring write lock
	if c.privateKey != nil && time.Since(c.cachedAt) < c.cacheTTL {
		return &JWTKeyPair{
			PrivateKey: c.privateKey,
			PublicKey:  c.publicKey,
			KeyID:      c.keyID,
			Algorithm:  "RS256",
		}, nil
	}

	c.logger.Info("fetching JWT keys from Vault", zap.String("path", c.jwtSecretPath))

	secret, err := c.vc.Logical().Read(c.jwtSecretPath)
	if err != nil {
		return nil, fmt.Errorf("read vault secret: %w", err)
	}
	if secret == nil || secret.Data == nil {
		return nil, fmt.Errorf("JWT keys not found in Vault at path: %s", c.jwtSecretPath)
	}

	// KV v2 wraps data under "data" key
	data, ok := secret.Data["data"].(map[string]interface{})
	if !ok {
		data = secret.Data
	}

	privKeyB64, _ := data["private_key_pem"].(string)
	keyID, _ := data["key_id"].(string)

	if privKeyB64 == "" {
		return nil, fmt.Errorf("private_key_pem not found in Vault secret")
	}

	privKeyPEM, err := base64.StdEncoding.DecodeString(privKeyB64)
	if err != nil {
		return nil, fmt.Errorf("decode private key base64: %w", err)
	}

	privKey, err := parseRSAPrivateKey(privKeyPEM)
	if err != nil {
		return nil, fmt.Errorf("parse RSA private key: %w", err)
	}

	// kid 未提供時以公鑰 RFC 7638 指紋為 kid（金鑰輪轉時可辨識新舊金鑰）
	if keyID == "" {
		keyID = thumbprint(&privKey.PublicKey)
	}

	c.privateKey = privKey
	c.publicKey = &privKey.PublicKey
	c.keyID = keyID
	c.cachedAt = time.Now()

	c.logger.Info("JWT keys loaded from Vault", zap.String("kid", keyID))

	return &JWTKeyPair{
		PrivateKey: privKey,
		PublicKey:  &privKey.PublicKey,
		KeyID:      keyID,
		Algorithm:  "RS256",
	}, nil
}

// InvalidateCache 強制清除本地 Key Cache（Key Rotation 時使用）
func (c *Client) InvalidateCache() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.privateKey = nil
	c.publicKey = nil
	c.cachedAt = time.Time{}
	c.logger.Info("JWT key cache invalidated")
}

// thumbprint 回傳公鑰的 RFC 7638 JWK 指紋（作為 kid）。
func thumbprint(pub *rsa.PublicKey) string {
	n := base64.RawURLEncoding.EncodeToString(pub.N.Bytes())
	e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(pub.E)).Bytes())
	canonical := `{"e":"` + e + `","kty":"RSA","n":"` + n + `"}`
	h := sha256.Sum256([]byte(canonical))
	return base64.RawURLEncoding.EncodeToString(h[:])
}

// GetJWKSKeys 回傳 JWKS 應公開的公鑰：當前版本 + 前一版本（金鑰輪轉重疊窗，
// 讓輪轉前簽發、仍未過期的 token 仍可驗證）。
func (c *Client) GetJWKSKeys() ([]JWTKeyPair, error) {
	cur, err := c.GetJWTKeyPair()
	if err != nil {
		return nil, err
	}
	keys := []JWTKeyPair{*cur}
	if prev, perr := c.readPrevVersionPub(); perr == nil && prev != nil && prev.KeyID != cur.KeyID {
		keys = append(keys, *prev)
	}
	return keys, nil
}

// readPrevVersionPub 讀取 KV v2 前一版本的公鑰（best-effort，無前版時回 nil）。
func (c *Client) readPrevVersionPub() (*JWTKeyPair, error) {
	latest, err := c.vc.Logical().Read(c.jwtSecretPath)
	if err != nil || latest == nil {
		return nil, err
	}
	md, _ := latest.Data["metadata"].(map[string]interface{})
	if md == nil {
		return nil, nil
	}
	verNum, _ := md["version"].(json.Number)
	cur, _ := verNum.Int64()
	if cur <= 1 {
		return nil, nil
	}
	sec, err := c.vc.Logical().ReadWithData(c.jwtSecretPath, map[string][]string{"version": {fmt.Sprint(cur - 1)}})
	if err != nil || sec == nil {
		return nil, err
	}
	data, ok := sec.Data["data"].(map[string]interface{})
	if !ok {
		return nil, nil
	}
	pubB64, _ := data["public_key_pem"].(string)
	if pubB64 == "" {
		return nil, nil
	}
	pubPEM, err := base64.StdEncoding.DecodeString(pubB64)
	if err != nil {
		return nil, err
	}
	pub, err := parseRSAPublicKey(pubPEM)
	if err != nil {
		return nil, err
	}
	return &JWTKeyPair{PublicKey: pub, KeyID: thumbprint(pub), Algorithm: "RS256"}, nil
}

// RotateJWTKey 產生新的 RSA 金鑰對並寫入 Vault（KV v2 新版本），然後清快取。
// 供自動輪轉（背景排程）或手動觸發使用；前一版本仍保留供 JWKS 重疊驗證。
func (c *Client) RotateJWTKey() error {
	newKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return fmt.Errorf("generate rsa key: %w", err)
	}
	privDER, err := x509.MarshalPKCS8PrivateKey(newKey)
	if err != nil {
		return fmt.Errorf("marshal priv: %w", err)
	}
	privPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privDER})
	pubDER, err := x509.MarshalPKIXPublicKey(&newKey.PublicKey)
	if err != nil {
		return fmt.Errorf("marshal pub: %w", err)
	}
	pubPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDER})
	_, err = c.vc.Logical().Write(c.jwtSecretPath, map[string]interface{}{
		"data": map[string]interface{}{
			"private_key_pem": base64.StdEncoding.EncodeToString(privPEM),
			"public_key_pem":  base64.StdEncoding.EncodeToString(pubPEM),
		},
	})
	if err != nil {
		return fmt.Errorf("write rotated key to vault: %w", err)
	}
	c.InvalidateCache()
	c.logger.Info("JWT signing key rotated (new Vault KV version written)")
	return nil
}

// GetSecret 取得任意 KV v2 Secret
func (c *Client) GetSecret(path string) (map[string]interface{}, error) {
	secret, err := c.vc.Logical().Read(path)
	if err != nil {
		return nil, fmt.Errorf("read vault secret at %s: %w", path, err)
	}
	if secret == nil {
		return nil, fmt.Errorf("secret not found at path: %s", path)
	}
	// KV v2 data wrapper
	if data, ok := secret.Data["data"].(map[string]interface{}); ok {
		return data, nil
	}
	return secret.Data, nil
}

// Health Vault 連線健康檢查
func (c *Client) Health() error {
	health, err := c.vc.Sys().Health()
	if err != nil {
		return fmt.Errorf("vault health check: %w", err)
	}
	if !health.Initialized {
		return fmt.Errorf("vault not initialized")
	}
	if health.Sealed {
		return fmt.Errorf("vault is sealed")
	}
	return nil
}

func parseRSAPrivateKey(pemBytes []byte) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return nil, fmt.Errorf("failed to decode PEM block")
	}

	switch block.Type {
	case "RSA PRIVATE KEY":
		return x509.ParsePKCS1PrivateKey(block.Bytes)
	case "PRIVATE KEY":
		key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
		if err != nil {
			return nil, err
		}
		rsaKey, ok := key.(*rsa.PrivateKey)
		if !ok {
			return nil, fmt.Errorf("not an RSA private key")
		}
		return rsaKey, nil
	default:
		return nil, fmt.Errorf("unsupported PEM block type: %s", block.Type)
	}
}

func parseRSAPublicKey(pemBytes []byte) (*rsa.PublicKey, error) {
	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return nil, fmt.Errorf("failed to decode public PEM block")
	}
	key, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	rsaPub, ok := key.(*rsa.PublicKey)
	if !ok {
		return nil, fmt.Errorf("not an RSA public key")
	}
	return rsaPub, nil
}
