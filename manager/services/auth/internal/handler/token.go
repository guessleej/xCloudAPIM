package handler

import (
	"encoding/base64"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/xcloudapim/auth-service/internal/domain"
	"go.uber.org/zap"
)

// Token POST /oauth2/token
// Content-Type: application/x-www-form-urlencoded
// Supports: authorization_code / client_credentials / refresh_token
func (h *Handlers) Token(c *gin.Context) {
	req := &domain.TokenRequest{
		GrantType:    c.PostForm("grant_type"),
		Code:         c.PostForm("code"),
		RedirectURI:  c.PostForm("redirect_uri"),
		CodeVerifier: c.PostForm("code_verifier"),
		RefreshToken: c.PostForm("refresh_token"),
		Scope:        c.PostForm("scope"),
	}

	// Client 認證：支援 Basic Auth 與 Body 方式
	clientID, clientSecret := extractClientCredentials(c)
	req.ClientID = clientID
	req.ClientSecret = clientSecret

	if req.GrantType == "" {
		oauthErrorResponse(c, domain.ErrInvalidRequest("grant_type is required"))
		return
	}

	resp, err := h.authService.Token(c.Request.Context(), req, c.ClientIP())
	if err != nil {
		h.logger.Warn("token request failed",
			zap.String("grant_type", req.GrantType),
			zap.String("client_id", req.ClientID),
			zap.Error(err),
		)
		oauthErrorResponse(c, err)
		return
	}

	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	c.JSON(http.StatusOK, resp)
}

// JWKS GET /oauth2/jwks
// 回傳 RSA 公鑰（供 Gateway 驗證 JWT 簽章）
func (h *Handlers) JWKS(c *gin.Context) {
	jwks, err := h.authService.GetJWKS(c.Request.Context())
	if err != nil {
		h.logger.Error("get JWKS failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "server_error"})
		return
	}
	c.Header("Cache-Control", "public, max-age=3600")
	c.JSON(http.StatusOK, jwks)
}

// Revoke POST /oauth2/revoke（RFC 7009）
func (h *Handlers) Revoke(c *gin.Context) {
	token := c.PostForm("token")
	if token == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":             "invalid_request",
			"error_description": "token is required",
		})
		return
	}

	clientID, clientSecret := extractClientCredentials(c)

	if err := h.authService.Revoke(c.Request.Context(), token, clientID, clientSecret); err != nil {
		h.logger.Warn("revoke failed",
			zap.String("client_id", clientID),
			zap.Error(err),
		)
		// RFC 7009: 即使 Token 無效，也應回傳 200（防止 Token 存在性探測）
		if oauthErr, ok := err.(*domain.OAuthError); ok && oauthErr.Code == "invalid_client" {
			oauthErrorResponse(c, err)
			return
		}
	}
	c.Status(http.StatusOK)
}

// OpenIDConfig GET /oauth2/.well-known/openid-configuration
func (h *Handlers) OpenIDConfig(c *gin.Context) {
	issuer := c.Request.Host
	if issuer == "" {
		issuer = "http://localhost:8081"
	}
	scheme := "https"
	if strings.HasPrefix(issuer, "localhost") || strings.HasPrefix(issuer, "127.") {
		scheme = "http"
	}
	base := scheme + "://" + issuer

	c.JSON(http.StatusOK, gin.H{
		"issuer":                                base,
		"authorization_endpoint":               base + "/oauth2/authorize",
		"token_endpoint":                        base + "/oauth2/token",
		"jwks_uri":                              base + "/oauth2/jwks",
		"revocation_endpoint":                   base + "/oauth2/revoke",
		"response_types_supported":              []string{"code"},
		"grant_types_supported":                 []string{"authorization_code", "client_credentials", "refresh_token"},
		"subject_types_supported":               []string{"public"},
		"id_token_signing_alg_values_supported": []string{"RS256"},
		"scopes_supported":                      []string{"openid", "profile", "email", "api:read", "api:write", "offline_access"},
		"token_endpoint_auth_methods_supported": []string{"client_secret_basic", "client_secret_post", "none"},
		"code_challenge_methods_supported":      []string{"S256", "plain"},
		"claims_supported":                      []string{"sub", "iss", "aud", "exp", "iat", "jti", "client_id", "scopes", "plan"},
	})
}

// ─── Health ───────────────────────────────────────────────────

func (h *Handlers) Health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "auth-service"})
}

func (h *Handlers) Ready(c *gin.Context) {
	// TODO: 實際檢查 DB / Redis 連線
	c.JSON(http.StatusOK, gin.H{"status": "ready"})
}

// ─── Helpers ─────────────────────────────────────────────────

func extractClientCredentials(c *gin.Context) (clientID, clientSecret string) {
	// 1. Basic Auth（優先）
	if auth := c.GetHeader("Authorization"); strings.HasPrefix(auth, "Basic ") {
		decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(auth, "Basic "))
		if err == nil {
			parts := strings.SplitN(string(decoded), ":", 2)
			if len(parts) == 2 {
				return parts[0], parts[1]
			}
		}
	}
	// 2. Form body
	return c.PostForm("client_id"), c.PostForm("client_secret")
}

func oauthErrorResponse(c *gin.Context, err error) {
	if oauthErr, ok := err.(*domain.OAuthError); ok {
		c.JSON(oauthErr.HTTPStatus, oauthErr)
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{
		"error":             "server_error",
		"error_description": err.Error(),
	})
}
