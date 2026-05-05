package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/xcloudapim/auth-service/internal/cache"
	"github.com/xcloudapim/auth-service/internal/repository"
	"github.com/xcloudapim/auth-service/internal/service"
	"go.uber.org/zap"
)

type Handlers struct {
	authService *service.AuthService
	db          *repository.DB
	redisCache  *cache.RedisCache
	logger      *zap.Logger
}

func NewHandlers(authService *service.AuthService, db *repository.DB, redisCache *cache.RedisCache, logger *zap.Logger) *Handlers {
	return &Handlers{authService: authService, db: db, redisCache: redisCache, logger: logger}
}

func SetupRouter(h *Handlers, env string) *gin.Engine {
	if env == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()

	// ─── Middleware ───────────────────────────────────────────
	r.Use(gin.Recovery())
	r.Use(requestLogger(h.logger))
	r.Use(securityHeaders())
	r.Use(corsMiddleware())

	// ─── Health / Metrics ─────────────────────────────────────
	r.GET("/health",  h.Health)
	r.GET("/ready",   h.Ready)
	r.GET("/metrics", gin.WrapH(promhttp.Handler()))

	// ─── OAuth2 Endpoints ─────────────────────────────────────
	oauth := r.Group("/oauth2")
	{
		oauth.GET( "/authorize", h.Authorize)   // Authorization Code + PKCE
		oauth.POST("/token",     h.Token)        // Token 端點（多 Grant Types）
		oauth.POST("/revoke",    h.Revoke)       // Token 撤銷（RFC 7009）
		oauth.GET( "/jwks",      h.JWKS)         // 公鑰 JWKS
		oauth.GET( "/.well-known/openid-configuration", h.OpenIDConfig) // OIDC Discovery
	}

	// ─── 404 Handler ──────────────────────────────────────────
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
		c.Header("Cache-Control", "no-store")
		c.Header("Pragma", "no-cache")
		c.Next()
	}
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
