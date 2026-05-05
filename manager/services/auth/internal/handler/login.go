package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/xcloudapim/auth-service/internal/service"
	"go.uber.org/zap"
)

// Login POST /auth/login
// Body: { "email": "...", "password": "..." }
// Response: { "session_token": "...", "expires_in": 3600 }
func (h *Handlers) Login(c *gin.Context) {
	var body struct {
		Email    string `json:"email"    binding:"required,email"`
		Password string `json:"password" binding:"required,min=8"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":             "invalid_request",
			"error_description": "email and password are required",
		})
		return
	}

	token, user, err := h.sessionService.Login(c.Request.Context(), body.Email, body.Password)
	if err != nil {
		h.logger.Warn("login failed", zap.String("email", body.Email), zap.Error(err))
		c.JSON(http.StatusUnauthorized, gin.H{
			"error":             "invalid_credentials",
			"error_description": "invalid email or password",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"session_token": token,
		"expires_in":    3600,
		"user": gin.H{
			"id":           user.ID.String(),
			"email":        user.Email,
			"display_name": user.DisplayName,
		},
	})
}

// requireSession middleware — 驗證 Authorization: Bearer <session_token>
// 成功後將 user_id 注入 gin context
func (h *Handlers) requireSession() gin.HandlerFunc {
	return func(c *gin.Context) {
		auth := c.GetHeader("Authorization")
		const prefix = "Bearer "
		if len(auth) <= len(prefix) || auth[:len(prefix)] != prefix {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":             "unauthorized",
				"error_description": "missing or invalid Authorization header",
			})
			c.Abort()
			return
		}
		tokenStr := auth[len(prefix):]

		userID, err := h.sessionService.VerifySessionToken(tokenStr)
		if err != nil {
			h.logger.Warn("session token invalid", zap.Error(err))
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":             "unauthorized",
				"error_description": "session token expired or invalid",
			})
			c.Abort()
			return
		}

		c.Set("session_user_id", userID.String())
		c.Next()
	}
}

// Logout POST /auth/logout（stateless session，清除 client 端 token 即可）
func (h *Handlers) Logout(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"message": "logged out"})
}

// Me GET /auth/me — 回傳目前登入使用者資訊
func (h *Handlers) Me(c *gin.Context) {
	userIDStr, exists := c.Get("session_user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"user_id": userIDStr})
}

// rateLimitMiddleware — 簡易 in-memory rate limit（Token Endpoint 等高風險端點）
func rateLimitMiddleware(store service.RateLimitStore, maxReq int, windowKey string) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := windowKey + ":" + c.ClientIP()
		allowed, err := store.Allow(c.Request.Context(), key, maxReq)
		if err != nil || !allowed {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error":             "too_many_requests",
				"error_description": "rate limit exceeded, please try again later",
			})
			c.Abort()
			return
		}
		c.Next()
	}
}
