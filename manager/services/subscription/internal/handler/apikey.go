package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/xcloudapim/subscription-service/internal/domain"
	"github.com/xcloudapim/subscription-service/internal/service"
)

type APIKeyHandler struct {
	svc *service.APIKeyService
}

func NewAPIKeyHandler(svc *service.APIKeyService) *APIKeyHandler {
	return &APIKeyHandler{svc: svc}
}

// POST /v1/subscriptions/:id/keys
func (h *APIKeyHandler) Create(c *gin.Context) {
	subID  := c.Param("id")
	orgID  := c.GetHeader("X-Org-ID")
	userID := c.GetHeader("X-User-ID")
	if orgID == "" || userID == "" {
		c.JSON(http.StatusBadRequest, errMsg("X-Org-ID and X-User-ID headers required"))
		return
	}

	var req domain.CreateAPIKeyReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errResp(err))
		return
	}

	key, err := h.svc.Create(c.Request.Context(), subID, orgID, userID, &req)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrSubscriptionNotActive):
			c.JSON(http.StatusForbidden, errResp(err))
		case errors.Is(err, domain.ErrMaxKeysReached):
			c.JSON(http.StatusUnprocessableEntity, errResp(err))
		default:
			c.JSON(http.StatusInternalServerError, errResp(err))
		}
		return
	}
	// PlainKey 只在此次回傳，提示使用者存好
	c.JSON(http.StatusCreated, key)
}

// GET /v1/subscriptions/:id/keys
func (h *APIKeyHandler) List(c *gin.Context) {
	keys, err := h.svc.ListBySubscription(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, errResp(err))
		return
	}
	// 確保 PlainKey 不在清單中洩漏
	for _, k := range keys {
		k.PlainKey = ""
		k.KeyHash = ""
	}
	c.JSON(http.StatusOK, gin.H{"keys": keys})
}

// DELETE /v1/subscriptions/:id/keys/:key_id
func (h *APIKeyHandler) Revoke(c *gin.Context) {
	userID := c.GetHeader("X-User-ID")
	var req domain.RevokeAPIKeyReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errResp(err))
		return
	}

	if err := h.svc.RevokeByID(c.Request.Context(), c.Param("id"), c.Param("key_id"), userID, req.Reason); err != nil {
		if errors.Is(err, domain.ErrAPIKeyNotFound) {
			c.JSON(http.StatusNotFound, errResp(err))
			return
		}
		c.JSON(http.StatusInternalServerError, errResp(err))
		return
	}
	c.Status(http.StatusNoContent)
}

// POST /internal/keys/verify  (Gateway 呼叫)
func (h *APIKeyHandler) Verify(c *gin.Context) {
	var body struct {
		Key string `json:"key" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, errResp(err))
		return
	}

	key, sub, plan, err := h.svc.Verify(c.Request.Context(), body.Key)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrAPIKeyNotFound):
			c.JSON(http.StatusUnauthorized, errMsg("invalid api key"))
		case errors.Is(err, domain.ErrAPIKeyRevoked):
			c.JSON(http.StatusUnauthorized, errMsg("api key has been revoked"))
		case errors.Is(err, domain.ErrAPIKeyExpired):
			c.JSON(http.StatusUnauthorized, errMsg("api key has expired"))
		case errors.Is(err, domain.ErrSubscriptionNotActive):
			c.JSON(http.StatusForbidden, errMsg("subscription is not active"))
		default:
			c.JSON(http.StatusInternalServerError, errResp(err))
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"key_id":          key.ID,
		"subscription_id": key.SubscriptionID,
		"organization_id": key.OrganizationID,
		"api_id":          sub.APIID,
		"plan":            plan.Name,
		"allowed_ips":     key.AllowedIPs,
		"allowed_origins": key.AllowedOrigins,
		"scopes":          key.Scopes,
	})
}
