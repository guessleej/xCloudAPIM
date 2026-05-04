package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/xcloudapim/subscription-service/internal/service"
)

type QuotaHandler struct {
	svc *service.QuotaService
}

func NewQuotaHandler(svc *service.QuotaService) *QuotaHandler {
	return &QuotaHandler{svc: svc}
}

// GET /v1/subscriptions/:id/quota
func (h *QuotaHandler) GetQuota(c *gin.Context) {
	subID := c.Param("id")
	apiID := c.Query("api_id")
	if apiID == "" {
		c.JSON(http.StatusBadRequest, errMsg("api_id query param required"))
		return
	}

	quota, err := h.svc.GetClientQuota(c.Request.Context(), subID, apiID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, errResp(err))
		return
	}
	c.JSON(http.StatusOK, quota)
}

// GET /v1/subscriptions/:id/usage
func (h *QuotaHandler) GetUsageHistory(c *gin.Context) {
	subID := c.Param("id")
	apiID := c.Query("api_id")

	var q struct {
		From  string `form:"from"   binding:"required"`
		To    string `form:"to"     binding:"required"`
		APIID string `form:"api_id" binding:"required"`
	}
	if err := c.ShouldBindQuery(&q); err != nil {
		c.JSON(http.StatusBadRequest, errResp(err))
		return
	}
	apiID = q.APIID

	rows, err := h.svc.GetUsageHistory(c.Request.Context(), subID, apiID, q.From, q.To)
	if err != nil {
		c.JSON(http.StatusInternalServerError, errResp(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"usage": rows})
}

// POST /internal/usage/increment  (Gateway 每請求後呼叫)
func (h *QuotaHandler) Increment(c *gin.Context) {
	var body struct {
		ClientID string `json:"client_id" binding:"required"`
		APIID    string `json:"api_id"    binding:"required"`
		Count    int64  `json:"count"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, errResp(err))
		return
	}
	if body.Count <= 0 {
		body.Count = 1
	}

	current, err := h.svc.IncrementUsage(c.Request.Context(), body.ClientID, body.APIID, body.Count)
	if err != nil {
		c.JSON(http.StatusInternalServerError, errResp(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"current_count": current})
}

// GET /internal/quota/check  (Gateway 請求前呼叫)
func (h *QuotaHandler) Check(c *gin.Context) {
	clientID := c.Query("client_id")
	apiID    := c.Query("api_id")
	if clientID == "" || apiID == "" {
		c.JSON(http.StatusBadRequest, errMsg("client_id and api_id required"))
		return
	}

	result, err := h.svc.CheckQuota(c.Request.Context(), clientID, apiID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, errResp(err))
		return
	}
	status := http.StatusOK
	if !result.Allowed {
		status = http.StatusTooManyRequests
	}
	c.JSON(status, result)
}

// ─── shared helpers ───────────────────────────────────────────

func errResp(err error) gin.H {
	return gin.H{"error": err.Error()}
}

func errMsg(msg string) gin.H {
	return gin.H{"error": msg}
}
