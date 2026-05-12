package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/xcloudapim/auth-service/internal/cache"
	"github.com/xcloudapim/auth-service/internal/domain"
	"github.com/xcloudapim/auth-service/internal/repository"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
)

type AuthService struct {
	clientRepo   *repository.ClientRepository
	tokenService *TokenService
	redisCache   *cache.RedisCache
	logger       *zap.Logger
	authCodeTTL  time.Duration
}

func NewAuthService(
	clientRepo *repository.ClientRepository,
	tokenService *TokenService,
	redisCache *cache.RedisCache,
	authCodeTTL time.Duration,
	logger *zap.Logger,
) *AuthService {
	return &AuthService{
		clientRepo:   clientRepo,
		tokenService: tokenService,
		redisCache:   redisCache,
		logger:       logger,
		authCodeTTL:  authCodeTTL,
	}
}

// Authorize 處理 Authorization Endpoint（PKCE Authorization Code Flow）
// 驗證後回傳 Authorization Code（實際重定向由 handler 處理）
func (s *AuthService) Authorize(ctx context.Context, req *domain.AuthorizeRequest, userID uuid.UUID) (string, error) {
	if req.ResponseType != "code" {
		return "", domain.ErrInvalidRequest("unsupported response_type, only 'code' is supported")
	}

	client, err := s.clientRepo.GetByClientID(ctx, req.ClientID)
	if err != nil {
		return "", domain.ErrInvalidClient("client not found or inactive")
	}
	if !client.HasGrantType(domain.GrantTypeAuthorizationCode) {
		return "", domain.ErrUnauthorizedClient("client does not support authorization_code grant")
	}
	if !client.HasRedirectURI(req.RedirectURI) {
		return "", domain.ErrInvalidRequest("redirect_uri not registered for this client")
	}

	// PKCE 必填（強制安全）
	if client.RequirePKCE {
		if req.CodeChallenge == "" {
			return "", domain.ErrInvalidRequest("code_challenge is required (PKCE)")
		}
		if req.CodeChallengeMethod == "" {
			req.CodeChallengeMethod = "S256"
		}
		if req.CodeChallengeMethod != "S256" {
			return "", domain.ErrInvalidRequest("code_challenge_method must be S256")
		}
	}

	// 驗證請求的 scopes
	scopes := parseScopes(req.Scope)
	for _, scope := range scopes {
		if !client.HasScope(scope) {
			return "", domain.ErrInvalidScope(fmt.Sprintf("scope '%s' not allowed", scope))
		}
	}

	// 產生授權碼
	code, err := generateSecureCode()
	if err != nil {
		return "", domain.ErrServerError("failed to generate authorization code")
	}

	codeData := &cache.AuthCodeCache{
		Code:                code,
		ClientID:            client.ID.String(),
		UserID:              userID.String(),
		RedirectURI:         req.RedirectURI,
		Scopes:              scopes,
		CodeChallenge:       req.CodeChallenge,
		CodeChallengeMethod: req.CodeChallengeMethod,
		Nonce:               req.Nonce,
	}

	if err := s.redisCache.SetAuthCode(ctx, code, codeData, s.authCodeTTL); err != nil {
		return "", domain.ErrServerError("failed to store authorization code")
	}

	s.logger.Info("authorization code issued",
		zap.String("client_id", req.ClientID),
		zap.String("user_id", userID.String()),
	)
	return code, nil
}

// Token 處理 Token Endpoint（多種 Grant Types）
func (s *AuthService) Token(ctx context.Context, req *domain.TokenRequest, ipAddr string) (*domain.TokenResponse, error) {
	switch req.GrantType {
	case domain.GrantTypeAuthorizationCode:
		return s.handleAuthorizationCode(ctx, req, ipAddr)
	case domain.GrantTypeClientCredentials:
		return s.handleClientCredentials(ctx, req, ipAddr)
	case domain.GrantTypeRefreshToken:
		return s.handleRefreshToken(ctx, req, ipAddr)
	default:
		return nil, domain.ErrUnsupportedGrantType(req.GrantType + " is not supported")
	}
}

// handleAuthorizationCode Authorization Code + PKCE Flow
func (s *AuthService) handleAuthorizationCode(ctx context.Context, req *domain.TokenRequest, ipAddr string) (*domain.TokenResponse, error) {
	if req.Code == "" {
		return nil, domain.ErrInvalidRequest("code is required")
	}
	if req.RedirectURI == "" {
		return nil, domain.ErrInvalidRequest("redirect_uri is required")
	}

	// 驗證 Client
	client, err := s.authenticateClient(ctx, req.ClientID, req.ClientSecret)
	if err != nil {
		return nil, err
	}

	// 從 Redis 取得授權碼（原子性刪除防重放）
	codeData, err := s.redisCache.GetAuthCode(ctx, req.Code)
	if err != nil || codeData == nil {
		return nil, domain.ErrInvalidGrant("authorization code not found or expired")
	}
	// 立即刪除（one-time use）— 刪除失敗直接拒絕，防止重放攻擊
	if err := s.redisCache.DeleteAuthCode(ctx, req.Code); err != nil {
		s.logger.Error("failed to delete auth code, rejecting to prevent replay", zap.Error(err))
		return nil, domain.ErrServerError("authorization code processing failed")
	}

	// 驗證 Client ID 一致
	if codeData.ClientID != client.ID.String() {
		return nil, domain.ErrInvalidGrant("authorization code was not issued to this client")
	}

	// 驗證 Redirect URI
	if codeData.RedirectURI != req.RedirectURI {
		return nil, domain.ErrInvalidGrant("redirect_uri mismatch")
	}

	// 驗證 PKCE
	if codeData.CodeChallenge != "" {
		if err := VerifyPKCE(req.CodeVerifier, codeData.CodeChallenge, codeData.CodeChallengeMethod); err != nil {
			return nil, domain.ErrInvalidGrant("PKCE verification failed")
		}
	}

	userID, err := uuid.Parse(codeData.UserID)
	if err != nil {
		return nil, domain.ErrServerError("invalid user_id in authorization code")
	}

	s.logger.Info("issuing tokens via authorization_code",
		zap.String("client_id", req.ClientID),
		zap.String("user_id", codeData.UserID),
	)

	return s.tokenService.IssueTokenPair(ctx, client, &userID, codeData.Scopes, ipAddr)
}

// handleClientCredentials M2M 流程（無使用者）
func (s *AuthService) handleClientCredentials(ctx context.Context, req *domain.TokenRequest, ipAddr string) (*domain.TokenResponse, error) {
	client, err := s.authenticateClient(ctx, req.ClientID, req.ClientSecret)
	if err != nil {
		return nil, err
	}
	if !client.HasGrantType(domain.GrantTypeClientCredentials) {
		return nil, domain.ErrUnauthorizedClient("client_credentials not allowed for this client")
	}

	scopes := parseScopes(req.Scope)
	if len(scopes) == 0 {
		scopes = client.Scopes
	}
	for _, scope := range scopes {
		if !client.HasScope(scope) {
			return nil, domain.ErrInvalidScope("scope not allowed: " + scope)
		}
	}

	s.logger.Info("issuing token via client_credentials",
		zap.String("client_id", req.ClientID),
	)

	return s.tokenService.IssueTokenPair(ctx, client, nil, scopes, ipAddr)
}

// handleRefreshToken Refresh Token Rotation
func (s *AuthService) handleRefreshToken(ctx context.Context, req *domain.TokenRequest, ipAddr string) (*domain.TokenResponse, error) {
	if req.RefreshToken == "" {
		return nil, domain.ErrInvalidRequest("refresh_token is required")
	}

	client, err := s.authenticateClient(ctx, req.ClientID, req.ClientSecret)
	if err != nil {
		return nil, err
	}

	return s.tokenService.RefreshAccessToken(ctx, req.RefreshToken, client, ipAddr)
}

// Revoke 撤銷 Token（RFC 7009）
func (s *AuthService) Revoke(ctx context.Context, tokenRaw, clientID, clientSecret string) error {
	client, err := s.authenticateClient(ctx, clientID, clientSecret)
	if err != nil {
		return err
	}
	return s.tokenService.RevokeToken(ctx, tokenRaw, client)
}

// authenticateClient 驗證 Client Credentials
func (s *AuthService) authenticateClient(ctx context.Context, clientID, clientSecret string) (*domain.OAuthClient, error) {
	if clientID == "" {
		return nil, domain.ErrInvalidClient("client_id is required")
	}

	client, err := s.clientRepo.GetByClientID(ctx, clientID)
	if err != nil {
		return nil, domain.ErrInvalidClient("client not found or inactive")
	}

	// PKCE-only client（public client）不需要 secret
	if client.TokenEndpointAuthMethod == "none" {
		return client, nil
	}

	if client.ClientSecretHash == nil {
		return nil, domain.ErrInvalidClient("client has no secret configured")
	}
	if clientSecret == "" {
		return nil, domain.ErrInvalidClient("client_secret is required")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(*client.ClientSecretHash), []byte(clientSecret)); err != nil {
		return nil, domain.ErrInvalidClient("invalid client_secret")
	}

	return client, nil
}

// GetJWKS 回傳 JWKS
func (s *AuthService) GetJWKS(ctx context.Context) (*domain.JWKS, error) {
	return s.tokenService.GetJWKS(ctx)
}

func parseScopes(scopeStr string) []string {
	if scopeStr == "" {
		return []string{}
	}
	parts := strings.Fields(scopeStr)
	seen := make(map[string]struct{}, len(parts))
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		if _, ok := seen[p]; !ok {
			seen[p] = struct{}{}
			result = append(result, p)
		}
	}
	return result
}

func generateSecureCode() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
