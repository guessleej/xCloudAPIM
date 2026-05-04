package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.uber.org/zap"
)

func NewRouter(
	subH    *SubscriptionHandler,
	keyH    *APIKeyHandler,
	quotaH  *QuotaHandler,
	log     *zap.Logger,
	env     string,
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
	r.GET("/metrics", gin.WrapH(promhttp.Handler()))

	// ─── Public: Plans ────────────────────────────────────────
	v1 := r.Group("/v1")
	v1.GET("/plans",     subH.ListPlans)
	v1.GET("/plans/:id", subH.GetPlan)

	// ─── Subscriptions ────────────────────────────────────────
	subs := v1.Group("/subscriptions")
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

	// ─── Internal（Gateway 呼叫） ─────────────────────────────
	internal := r.Group("/internal")
	internal.POST("/keys/verify",        keyH.Verify)
	internal.POST("/usage/increment",     quotaH.Increment)
	internal.GET("/quota/check",          quotaH.Check)

	return r
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
