package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
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
			"org_id":       uuidString(user.OrgID),
			"org_name":     user.OrgName,
			"role":         strings.ToUpper(user.Role),
		},
	})
}

func (h *Handlers) Register(c *gin.Context) {
	var body struct {
		Name     string `json:"name"     binding:"required,min=2,max=100"`
		Email    string `json:"email"    binding:"required,email"`
		Password string `json:"password" binding:"required,min=8"`
		OrgName  string `json:"orgName"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":             "invalid_request",
			"error_description": "name, email and password are required",
		})
		return
	}

	token, user, err := h.sessionService.Register(
		c.Request.Context(),
		body.Name,
		body.Email,
		body.Password,
		body.OrgName,
	)
	if err != nil {
		h.logger.Warn("register failed", zap.String("email", body.Email), zap.Error(err))
		status := http.StatusUnprocessableEntity
		description := "unable to create account"
		if errors.Is(err, service.ErrEmailAlreadyRegistered) {
			status = http.StatusConflict
			description = "email already registered"
		}
		c.JSON(status, gin.H{
			"error":             "registration_failed",
			"error_description": description,
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"session_token": token,
		"expires_in":    3600,
		"user": gin.H{
			"id":           user.ID.String(),
			"email":        user.Email,
			"display_name": user.DisplayName,
			"org_id":       uuidString(user.OrgID),
			"org_name":     user.OrgName,
			"role":         strings.ToUpper(user.Role),
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

		identity, err := h.sessionService.VerifySessionToken(tokenStr)
		if err != nil {
			h.logger.Warn("session token invalid", zap.Error(err))
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":             "unauthorized",
				"error_description": "session token expired or invalid",
			})
			c.Abort()
			return
		}

		c.Set("session_user_id", identity.UserID.String())
		c.Set("session_org_id", uuidString(identity.OrgID))
		c.Set("session_role", identity.Role)
		c.Set("session_email", identity.Email)
		c.Set("session_display_name", identity.DisplayName)
		c.Set("session_org_name", identity.OrgName)
		c.Next()
	}
}

// Logout POST /auth/logout — 撤銷 session token（加入 Redis blacklist）
func (h *Handlers) Logout(c *gin.Context) {
	auth := c.GetHeader("Authorization")
	const prefix = "Bearer "
	if len(auth) > len(prefix) && auth[:len(prefix)] == prefix {
		tokenStr := auth[len(prefix):]
		if err := h.sessionService.RevokeSessionToken(c.Request.Context(), tokenStr); err != nil {
			h.logger.Warn("logout: revoke token failed", zap.Error(err))
			// 不中斷回應，token 最終仍會過期
		}
	}
	c.JSON(http.StatusOK, gin.H{"message": "logged out"})
}

// Me GET /auth/me — 回傳目前登入使用者資訊
func (h *Handlers) Me(c *gin.Context) {
	userIDStr, exists := c.Get("session_user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id":           userIDStr,
		"email":        c.GetString("session_email"),
		"display_name": c.GetString("session_display_name"),
		"org_id":       c.GetString("session_org_id"),
		"org_name":     c.GetString("session_org_name"),
		"role":         strings.ToUpper(c.GetString("session_role")),
	})
}

// rateLimitMiddleware — 簡易 in-memory rate limit（Token Endpoint 等高風險端點）
func rateLimitMiddleware(store service.RateLimitStore, maxReq int, windowKey string) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := windowKey + ":" + c.ClientIP()
		allowed, err := store.Allow(c.Request.Context(), key, maxReq)
		if err != nil {
			c.Next()
			return
		}
		if !allowed {
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

func uuidString(id *uuid.UUID) string {
	if id == nil {
		return ""
	}
	return id.String()
}
