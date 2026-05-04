package service

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"strings"
	"time"

	jwtlib "github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/xcloudapim/auth-service/internal/cache"
	"github.com/xcloudapim/auth-service/internal/domain"
	"github.com/xcloudapim/auth-service/internal/repository"
	"github.com/xcloudapim/auth-service/internal/vault"
	"go.uber.org/zap"
)

type TokenService struct {
	tokenRepo  *repository.TokenRepository
	redisCache *cache.RedisCache
	vaultCli   *vault.Client
	logger     *zap.Logger

	issuer          string
	accessTokenTTL  time.Duration
	refreshTokenTTL time.Duration
}

func NewTokenService(
	tokenRepo *repository.TokenRepository,
	redisCache *cache.RedisCache,
	vaultCli *vault.Client,
	issuer string,
	accessTokenTTL, refreshTokenTTL time.Duration,
	logger *zap.Logger,
) *TokenService {
	return &TokenService{
		tokenRepo:       tokenRepo,
		redisCache:      redisCache,
		vaultCli:        vaultCli,
		logger:          logger,
		issuer:          issuer,
		accessTokenTTL:  accessTokenTTL,
		refreshTokenTTL: refreshTokenTTL,
	}
}

// IssueTokenPair 簽發 Access Token + Refresh Token
func (s *TokenService) IssueTokenPair(
	ctx context.Context,
	client *domain.OAuthClient,
	userID *uuid.UUID,
	scopes []string,
	ipAddr string,
) (*domain.TokenResponse, error) {

	subject := client.ClientID
	if userID != nil {
		subject = userID.String()
	}

	accessToken, accessHash, err := s.signJWT(ctx, subject, client, scopes, s.accessTokenTTL)
	if err != nil {
		return nil, fmt.Errorf("sign access token: %w", err)
	}

	// 持久化 Access Token
	atRecord := &domain.Token{
		ID:        uuid.New(),
		TokenHash: accessHash,
		TokenType: domain.TokenTypeAccess,
		ClientID:  client.ID,
		UserID:    userID,
		Scopes:    scopes,
		Subject:   subject,
		Audience:  []string{s.issuer},
		ExpiresAt: time.Now().Add(s.accessTokenTTL),
		IssuedAt:  time.Now(),
		IPAddress: ipAddr,
	}
	if client.SubscriptionID != nil {
		atRecord.SubscriptionID = client.SubscriptionID
	}
	if err := s.tokenRepo.CreateToken(ctx, atRecord); err != nil {
		return nil, fmt.Errorf("persist access token: %w", err)
	}
	// Redis 快取 Claims
	if err := s.redisCache.SetToken(ctx, accessHash, atRecord, s.accessTokenTTL); err != nil {
		s.logger.Warn("cache access token failed", zap.Error(err))
	}

	// Refresh Token（opaque random string）
	refreshRaw, refreshHash, err := generateOpaqueToken()
	if err != nil {
		return nil, fmt.Errorf("generate refresh token: %w", err)
	}

	rtRecord := &domain.Token{
		ID:            uuid.New(),
		TokenHash:     refreshHash,
		TokenType:     domain.TokenTypeRefresh,
		ClientID:      client.ID,
		UserID:        userID,
		Scopes:        scopes,
		Subject:       subject,
		Audience:      []string{s.issuer},
		ExpiresAt:     time.Now().Add(s.refreshTokenTTL),
		IssuedAt:      time.Now(),
		ParentTokenID: &atRecord.ID,
		IPAddress:     ipAddr,
	}
	if err := s.tokenRepo.CreateToken(ctx, rtRecord); err != nil {
		return nil, fmt.Errorf("persist refresh token: %w", err)
	}

	return &domain.TokenResponse{
		AccessToken:  accessToken,
		TokenType:    "Bearer",
		ExpiresIn:    int(s.accessTokenTTL.Seconds()),
		RefreshToken: refreshRaw,
		Scope:        strings.Join(scopes, " "),
	}, nil
}

// RefreshAccessToken 使用 Refresh Token 換發新 Access Token
func (s *TokenService) RefreshAccessToken(
	ctx context.Context,
	refreshTokenRaw string,
	client *domain.OAuthClient,
	ipAddr string,
) (*domain.TokenResponse, error) {

	hash := hashToken(refreshTokenRaw)

	// 檢查黑名單
	revoked, err := s.redisCache.IsRevoked(ctx, hash)
	if err != nil {
		s.logger.Warn("check revoked failed", zap.Error(err))
	}
	if revoked {
		return nil, domain.ErrTokenRevoked
	}

	// 查 DB
	rt, err := s.tokenRepo.GetByHash(ctx, hash)
	if err != nil {
		return nil, domain.ErrInvalidGrant("refresh token not found or invalid")
	}
	if !rt.IsValid() {
		return nil, domain.ErrInvalidGrant("refresh token expired or revoked")
	}
	if rt.ClientID != client.ID {
		return nil, domain.ErrInvalidGrant("refresh token does not belong to this client")
	}

	// 撤銷舊 Refresh Token（Rotation）
	if err := s.tokenRepo.RevokeToken(ctx, hash, "rotated"); err != nil {
		s.logger.Warn("revoke old refresh token failed", zap.Error(err))
	}
	s.redisCache.RevokeToken(ctx, hash, s.refreshTokenTTL) //nolint:errcheck

	// 換發新 Token Pair
	return s.IssueTokenPair(ctx, client, rt.UserID, rt.Scopes, ipAddr)
}

// RevokeToken 撤銷 Token（支援 access_token 與 refresh_token）
func (s *TokenService) RevokeToken(ctx context.Context, tokenRaw string, client *domain.OAuthClient) error {
	hash := hashToken(tokenRaw)

	// JWT Access Token: decode 取 exp 計算 TTL
	var ttl time.Duration
	if claims, err := s.decodeTokenWithoutVerify(tokenRaw); err == nil {
		if exp, ok := claims["exp"].(float64); ok {
			remaining := time.Until(time.Unix(int64(exp), 0))
			if remaining > 0 {
				ttl = remaining
			}
		}
	}
	if ttl == 0 {
		ttl = 24 * time.Hour
	}

	// DB 更新
	if err := s.tokenRepo.RevokeToken(ctx, hash, "client_revoke"); err != nil {
		if err != domain.ErrTokenNotFound {
			return err
		}
	}

	// Redis 加入黑名單
	return s.redisCache.RevokeToken(ctx, hash, ttl)
}

// GetJWKS 回傳公鑰的 JWKS 格式（供 Gateway 驗證用）
func (s *TokenService) GetJWKS(ctx context.Context) (*domain.JWKS, error) {
	keyPair, err := s.vaultCli.GetJWTKeyPair()
	if err != nil {
		return nil, fmt.Errorf("get JWT key pair: %w", err)
	}
	return buildJWKS(keyPair.PublicKey, keyPair.KeyID), nil
}

// ─── Private ─────────────────────────────────────────────────

func (s *TokenService) signJWT(
	ctx context.Context,
	subject string,
	client *domain.OAuthClient,
	scopes []string,
	ttl time.Duration,
) (string, string, error) {

	keyPair, err := s.vaultCli.GetJWTKeyPair()
	if err != nil {
		return "", "", fmt.Errorf("get JWT key pair: %w", err)
	}

	now := time.Now()
	jti := uuid.New().String()

	claims := jwtlib.MapClaims{
		"jti":       jti,
		"iss":       s.issuer,
		"sub":       subject,
		"aud":       []string{s.issuer},
		"iat":       now.Unix(),
		"exp":       now.Add(ttl).Unix(),
		"client_id": client.ClientID,
		"scopes":    scopes,
		"plan":      client.Plan,
	}

	token := jwtlib.NewWithClaims(jwtlib.SigningMethodRS256, claims)
	token.Header["kid"] = keyPair.KeyID

	signed, err := token.SignedString(keyPair.PrivateKey)
	if err != nil {
		return "", "", fmt.Errorf("sign JWT: %w", err)
	}

	return signed, hashToken(signed), nil
}

func (s *TokenService) decodeTokenWithoutVerify(tokenStr string) (jwtlib.MapClaims, error) {
	p := jwtlib.NewParser()
	token, _, err := p.ParseUnverified(tokenStr, jwtlib.MapClaims{})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(jwtlib.MapClaims)
	if !ok {
		return nil, fmt.Errorf("invalid claims type")
	}
	return claims, nil
}

func hashToken(raw string) string {
	h := sha256.Sum256([]byte(raw))
	return base64.RawURLEncoding.EncodeToString(h[:])
}

func generateOpaqueToken() (raw, hash string, err error) {
	b := make([]byte, 48)
	if _, err = rand.Read(b); err != nil {
		return
	}
	raw = base64.RawURLEncoding.EncodeToString(b)
	hash = hashToken(raw)
	return
}

func buildJWKS(pub *rsa.PublicKey, kid string) *domain.JWKS {
	n := base64.RawURLEncoding.EncodeToString(pub.N.Bytes())
	e := base64.RawURLEncoding.EncodeToString(
		big.NewInt(int64(pub.E)).Bytes(),
	)
	return &domain.JWKS{
		Keys: []domain.JWK{{
			KeyType:   "RSA",
			Use:       "sig",
			KeyID:     kid,
			Algorithm: "RS256",
			N:         n,
			E:         e,
		}},
	}
}

func decodeJWTPayload(tokenStr string) (map[string]interface{}, error) {
	parts := strings.Split(tokenStr, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid JWT format")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, err
	}
	var claims map[string]interface{}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return nil, err
	}
	return claims, nil
}
