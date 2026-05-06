package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/xcloudapim/policy-engine/internal/middleware"
	"github.com/xcloudapim/policy-engine/internal/repository"
	"github.com/xcloudapim/policy-engine/internal/service"
	"go.uber.org/zap"
)

type Handlers struct {
	chainSvc *service.ChainService
	db       *repository.DB
	logger   *zap.Logger
}

func NewHandlers(chainSvc *service.ChainService, db *repository.DB, logger *zap.Logger) *Handlers {
	return &Handlers{chainSvc: chainSvc, db: db, logger: logger}
}

func SetupRouter(h *Handlers, env string) *gin.Engine {
	if env == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(requestLogger(h.logger))
	r.Use(securityHeaders())

	// ─── Health / Metrics ─────────────────────────────────────
	r.GET("/healthz", h.Health)
	r.GET("/ready",   h.Ready)
	r.GET("/metrics", gin.WrapH(promhttp.Handler()))

	// ─── Gateway / Internal endpoints (InternalAuth) ─────────
	internal := r.Group("", middleware.InternalAuth())
	{
		internal.GET("/v1/chains/:apiId",      h.GetGatewayChain)
		internal.POST("/v1/cache/invalidate",  h.InvalidateCache)
	}

	// ─── Management API (X-Org-ID + X-User-ID headers) ───────
	v1 := r.Group("/v1")
	{
		chains := v1.Group("/chains")
		{
			chains.GET("",             h.ListChains)
			chains.POST("",            h.CreateChain)
			chains.GET("/:id",         h.GetChain)
			chains.PUT("/:id",         h.UpdateChain)
			chains.DELETE("/:id",      h.DeleteChain)
			chains.POST("/:id/publish", h.PublishChain)

			pol := chains.Group("/:id/policies")
			{
				pol.GET("",              h.ListPolicies)
				pol.POST("",             h.CreatePolicy)
				pol.PUT("/:policyId",    h.UpdatePolicy)
				pol.DELETE("/:policyId", h.DeletePolicy)
			}
		}

		v1.GET("/templates", h.ListTemplates)
	}

	r.NoRoute(func(c *gin.Context) {
		c.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND", "message": "route not found"})
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
			zap.String("org_id", c.GetHeader("X-Org-ID")),
		)
	}
}

func securityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("Cache-Control", "no-store")
		c.Next()
	}
}

func (h *Handlers) Health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "policy-engine"})
}

func (h *Handlers) Ready(c *gin.Context) {
	if err := h.db.PingContext(c.Request.Context()); err != nil {
		h.logger.Warn("readiness check: postgres ping failed", zap.Error(err))
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"status": "not ready",
			"checks": gin.H{"postgres": "unhealthy"},
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ready", "checks": gin.H{"postgres": "ok"}})
}
