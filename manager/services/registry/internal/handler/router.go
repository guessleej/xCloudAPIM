package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/xcloudapim/registry-service/internal/service"
	"go.uber.org/zap"
)

type Handlers struct {
	apiService *service.APIService
	logger     *zap.Logger
}

func NewHandlers(apiService *service.APIService, logger *zap.Logger) *Handlers {
	return &Handlers{apiService: apiService, logger: logger}
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
	r.GET("/health",  h.Health)
	r.GET("/ready",   h.Ready)
	r.GET("/metrics", gin.WrapH(promhttp.Handler()))

	// ─── API Management ───────────────────────────────────────
	// Header: X-Org-ID (required), X-User-ID (required)
	api := r.Group("/apis")
	{
		api.GET("",           h.ListAPIs)    // GET  /apis?page=1&status=published
		api.POST("",          h.CreateAPI)   // POST /apis
		api.GET("/:id",       h.GetAPI)      // GET  /apis/:id
		api.PUT("/:id",       h.UpdateAPI)   // PUT  /apis/:id
		api.DELETE("/:id",    h.DeleteAPI)   // DELETE /apis/:id

		// ─── Versions ─────────────────────────────────────────
		api.GET("/:id/versions",              h.ListVersions)   // GET  /apis/:id/versions
		api.POST("/:id/versions",             h.CreateVersion)  // POST /apis/:id/versions
		api.GET("/:id/versions/:version",     h.GetVersion)     // GET  /apis/:id/versions/1.0.0
		api.PUT("/:id/versions/:version",     h.UpdateVersion)  // PUT  /apis/:id/versions/1.0.0

		// ─── Spec 管理 ─────────────────────────────────────────
		api.GET("/:id/versions/:version/spec",  h.GetSpec)     // GET  /apis/:id/versions/1.0.0/spec?format=json
		api.PUT("/:id/versions/:version/spec",  h.UploadSpec)  // PUT  /apis/:id/versions/1.0.0/spec
		api.GET("/:id/spec",                    h.GetLatestSpec) // GET /apis/:id/spec (latest active)

		// ─── 生命週期 ─────────────────────────────────────────
		api.POST("/:id/versions/:version/publish",   h.PublishVersion)   // POST /apis/:id/versions/1.0.0/publish
		api.POST("/:id/versions/:version/deprecate", h.DeprecateVersion) // POST /apis/:id/versions/1.0.0/deprecate
	}

	// ─── Gateway Routes（供 API Gateway 消費） ─────────────────
	routes := r.Group("/internal/routes")
	{
		routes.GET("",       h.GetActiveRoutes) // GET /internal/routes
		routes.GET("/delta", h.GetRoutesDelta)  // GET /internal/routes/delta?since=<unix_ts>
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
	c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "registry-service"})
}

func (h *Handlers) Ready(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ready"})
}
