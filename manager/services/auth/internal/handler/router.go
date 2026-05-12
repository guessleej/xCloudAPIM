package handler

import (
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/xcloudapim/auth-service/internal/cache"
	"github.com/xcloudapim/auth-service/internal/repository"
	"github.com/xcloudapim/auth-service/internal/service"
	"go.uber.org/zap"
)

type Handlers struct {
	authService    *service.AuthService
	sessionService *service.SessionService
	rateLimitStore service.RateLimitStore
	db             *repository.DB
	redisCache     *cache.RedisCache
	logger         *zap.Logger
}

func NewHandlers(
	authService *service.AuthService,
	sessionService *service.SessionService,
	rateLimitStore service.RateLimitStore,
	db *repository.DB,
	redisCache *cache.RedisCache,
	logger *zap.Logger,
) *Handlers {
	return &Handlers{
		authService:    authService,
		sessionService: sessionService,
		rateLimitStore: rateLimitStore,
		db:             db,
		redisCache:     redisCache,
		logger:         logger,
	}
}

func SetupRouter(h *Handlers, env string) *gin.Engine {
	if env == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(requestLogger(h.logger))
	r.Use(securityHeaders())
	r.Use(corsMiddleware())

	// ─── Health / Metrics ─────────────────────────────────────
	r.GET("/health", h.Health)
	r.GET("/ready", h.Ready)
	r.GET("/metrics", gin.WrapH(promhttp.Handler()))

	// ─── 使用者登入端點（rate limit: 10 req/min/IP）────────────
	auth := r.Group("/auth")
	{
		auth.POST("/register", rateLimitMiddleware(h.rateLimitStore, 5, "rl:register"), h.Register)
		auth.POST("/login", rateLimitMiddleware(h.rateLimitStore, 10, "rl:login"), h.Login)
		auth.POST("/logout", h.requireSession(), h.Logout)
		auth.GET("/me", h.requireSession(), h.Me)
	}

	// ─── OAuth2 Endpoints ─────────────────────────────────────
	oauth := r.Group("/oauth2")
	{
		// authorize 需要已登入的 session token
		oauth.GET("/authorize", h.requireSession(), h.Authorize)
		// token/revoke: rate limit 20 req/min/IP
		oauth.POST("/token", rateLimitMiddleware(h.rateLimitStore, 20, "rl:token"), h.Token)
		oauth.POST("/revoke", rateLimitMiddleware(h.rateLimitStore, 20, "rl:token"), h.Revoke)
		oauth.GET("/jwks", h.JWKS)
		oauth.GET("/.well-known/openid-configuration", h.OpenIDConfig)
	}

	r.NoRoute(func(c *gin.Context) {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
	})

	return r
}

// ─── Middleware ───────────────────────────────────────────────

func requestLogger(logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		logger.Info("request",
			zap.String("method", c.Request.Method),
			zap.String("path", c.Request.URL.Path),
			zap.Int("status", c.Writer.Status()),
			zap.Duration("latency", time.Since(start)),
			zap.String("ip", c.ClientIP()),
		)
	}
}

func securityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("X-XSS-Protection", "1; mode=block")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		if c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https" {
			c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		c.Header("Cache-Control", "no-store")
		c.Header("Pragma", "no-cache")
		c.Next()
	}
}

func corsMiddleware() gin.HandlerFunc {
	allowedOrigins := buildAllowedOrigins()
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" && isAllowedOrigin(origin, allowedOrigins) {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Vary", "Origin")
		}
		c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

func buildAllowedOrigins() []string {
	raw := os.Getenv("AUTH_CORS_ALLOWED_ORIGINS")
	if raw == "" {
		raw = "http://localhost:3001,http://localhost:5173"
	}
	parts := strings.Split(raw, ",")
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		if s := strings.TrimSpace(p); s != "" {
			result = append(result, s)
		}
	}
	return result
}

func isAllowedOrigin(origin string, allowed []string) bool {
	for _, a := range allowed {
		if a == origin {
			return true
		}
	}
	return false
}
