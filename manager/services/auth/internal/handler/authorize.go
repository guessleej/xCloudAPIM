package handler

import (
	"fmt"
	"net/http"
	"net/url"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/xcloudapim/auth-service/internal/domain"
	"go.uber.org/zap"
)

// Authorize GET /oauth2/authorize
// Authorization Code Flow with PKCE
// Query Params: response_type, client_id, redirect_uri, scope, state,
//               code_challenge, code_challenge_method, nonce
func (h *Handlers) Authorize(c *gin.Context) {
	req := &domain.AuthorizeRequest{
		ResponseType:        c.Query("response_type"),
		ClientID:            c.Query("client_id"),
		RedirectURI:         c.Query("redirect_uri"),
		Scope:               c.Query("scope"),
		State:               c.Query("state"),
		Nonce:               c.Query("nonce"),
		CodeChallenge:       c.Query("code_challenge"),
		CodeChallengeMethod: c.Query("code_challenge_method"),
	}

	// 基本參數驗證
	if req.ClientID == "" || req.RedirectURI == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":             "invalid_request",
			"error_description": "client_id and redirect_uri are required",
		})
		return
	}

	// 驗證 redirect_uri 格式
	if _, err := url.ParseRequestURI(req.RedirectURI); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":             "invalid_request",
			"error_description": "redirect_uri is not a valid URI",
		})
		return
	}

	// 由 requireSession middleware 注入，確保使用者已通過 POST /auth/login 認證
	userIDStr, exists := c.Get("session_user_id")
	if !exists {
		loginURL := fmt.Sprintf("/login?redirect=%s", url.QueryEscape(c.Request.RequestURI))
		c.Redirect(http.StatusFound, loginURL)
		return
	}

	userID, err := uuid.Parse(userIDStr.(string))
	if err != nil {
		redirectWithError(c, req.RedirectURI, req.State, "server_error", "internal server error")
		return
	}

	code, err := h.authService.Authorize(c.Request.Context(), req, userID)
	if err != nil {
		h.logger.Warn("authorize failed", zap.Error(err))
		if oauthErr, ok := err.(*domain.OAuthError); ok {
			redirectWithError(c, req.RedirectURI, req.State, oauthErr.Code, oauthErr.Description)
		} else {
			redirectWithError(c, req.RedirectURI, req.State, "server_error", "internal server error")
		}
		return
	}

	// 重定向至 redirect_uri，攜帶 code 與 state
	redirectURL, _ := url.Parse(req.RedirectURI)
	q := redirectURL.Query()
	q.Set("code", code)
	if req.State != "" {
		q.Set("state", req.State)
	}
	redirectURL.RawQuery = q.Encode()

	c.Redirect(http.StatusFound, redirectURL.String())
}

func redirectWithError(c *gin.Context, redirectURI, state, errCode, errDesc string) {
	u, err := url.Parse(redirectURI)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":             errCode,
			"error_description": errDesc,
		})
		return
	}
	q := u.Query()
	q.Set("error", errCode)
	q.Set("error_description", errDesc)
	if state != "" {
		q.Set("state", state)
	}
	u.RawQuery = q.Encode()
	c.Redirect(http.StatusFound, u.String())
}
