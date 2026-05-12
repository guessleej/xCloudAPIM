package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
	"github.com/xcloudapim/subscription-service/internal/middleware"
	"go.uber.org/zap"
)

func NewRouter(
	subH    *SubscriptionHandler,
	keyH    *APIKeyHandler,
	quotaH  *QuotaHandler,
	log     *zap.Logger,
	env     string,
	db      *sqlx.DB,
	rdb     *redis.Client,
) *gin.Engine {
	if env == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	r.Use(loggerMiddleware(log), gin.Recovery())

	// ─── Health ───────────────────────────────────────────────
	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	r.GET("/ready", func(c *gin.Context) {
		checks := gin.H{}
		if err := db.PingContext(c.Request.Context()); err != nil {
			log.Warn("readiness: postgres ping failed", zap.Error(err))
			checks["postgres"] = "unhealthy"
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "not ready", "checks": checks})
			return
		}
		checks["postgres"] = "ok"
		if err := rdb.Ping(c.Request.Context()).Err(); err != nil {
			log.Warn("readiness: redis ping failed", zap.Error(err))
			checks["redis"] = "unhealthy"
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "not ready", "checks": checks})
			return
		}
		checks["redis"] = "ok"
		c.JSON(http.StatusOK, gin.H{"status": "ready", "checks": checks})
	})
	r.GET("/metrics", gin.WrapH(promhttp.Handler()))

	// ─── Public: Plans ────────────────────────────────────────
	v1 := r.Group("/v1")
	v1.GET("/plans",     subH.ListPlans)
	v1.GET("/plans/:id", subH.GetPlan)

	// ─── Subscriptions（需要有效 X-Org-ID + X-User-ID）─────────
	subs := v1.Group("/subscriptions", requireIdentityHeaders())
	subs.POST("",              subH.Create)
	subs.GET("",               subH.List)
	subs.GET("/:id",           subH.Get)
	subs.PUT("/:id/approve",   subH.Approve)
	subs.PUT("/:id/suspend",   subH.Suspend)
	subs.PUT("/:id/cancel",    subH.Cancel)
	subs.PUT("/:id/plan",      subH.ChangePlan)

	// ─── API Keys ─────────────────────────────────────────────
	subs.POST("/:id/keys",          keyH.Create)
	subs.GET("/:id/keys",           keyH.List)
	subs.DELETE("/:id/keys/:key_id", keyH.Revoke)

	// ─── Usage / Quota ────────────────────────────────────────
	subs.GET("/:id/quota",    quotaH.GetQuota)
	subs.GET("/:id/usage",    quotaH.GetUsageHistory)

	// ─── Internal（Gateway 呼叫，需 X-Internal-Token）────────
	internal := r.Group("/internal", middleware.InternalAuth())
	internal.POST("/keys/verify",     keyH.Verify)
	internal.POST("/usage/increment",  quotaH.Increment)
	internal.GET("/quota/check",       quotaH.Check)

	return r
}

// requireIdentityHeaders 驗證 Gateway 注入的身份 headers 格式正確
func requireIdentityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID := c.GetHeader("X-Org-ID")
		userID := c.GetHeader("X-User-ID")
		if orgID == "" || userID == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "missing identity headers"})
			c.Abort()
			return
		}
		if _, err := uuid.Parse(orgID); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid X-Org-ID format"})
			c.Abort()
			return
		}
		if _, err := uuid.Parse(userID); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid X-User-ID format"})
			c.Abort()
			return
		}
		c.Next()
	}
}

func loggerMiddleware(log *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()
		log.Info("http",
			zap.String("method", c.Request.Method),
			zap.String("path", c.FullPath()),
			zap.Int("status", c.Writer.Status()),
		)
	}
}
