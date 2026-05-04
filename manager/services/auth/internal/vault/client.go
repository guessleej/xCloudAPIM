package vault

import (
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"fmt"
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
	vc.SetToken(token)

	return &Client{
		vc:            vc,
		jwtSecretPath: jwtSecretPath,
		logger:        logger,
		cacheTTL:      5 * time.Minute,
	}, nil
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
