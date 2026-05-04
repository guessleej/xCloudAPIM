package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/xcloudapim/subscription-service/internal/domain"
	"github.com/xcloudapim/subscription-service/internal/service"
)

type SubscriptionHandler struct {
	svc *service.SubscriptionService
}

func NewSubscriptionHandler(svc *service.SubscriptionService) *SubscriptionHandler {
	return &SubscriptionHandler{svc: svc}
}

func (h *SubscriptionHandler) ListPlans(c *gin.Context) {
	plans, err := h.svc.ListPlans(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, errResp(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"plans": plans})
}

func (h *SubscriptionHandler) GetPlan(c *gin.Context) {
	plan, err := h.svc.GetPlan(c.Request.Context(), c.Param("id"))
	if err != nil {
		if errors.Is(err, domain.ErrPlanNotFound) {
			c.JSON(http.StatusNotFound, errResp(err))
			return
		}
		c.JSON(http.StatusInternalServerError, errResp(err))
		return
	}
	c.JSON(http.StatusOK, plan)
}

func (h *SubscriptionHandler) Create(c *gin.Context) {
	orgID := c.GetHeader("X-Org-ID")
	userID := c.GetHeader("X-User-ID")
	if orgID == "" || userID == "" {
		c.JSON(http.StatusBadRequest, errMsg("X-Org-ID and X-User-ID headers required"))
		return
	}

	var req domain.CreateSubscriptionReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errResp(err))
		return
	}

	sub, err := h.svc.Create(c.Request.Context(), orgID, userID, &req)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrSubscriptionExists):
			c.JSON(http.StatusConflict, errResp(err))
		case errors.Is(err, domain.ErrPlanNotFound):
			c.JSON(http.StatusBadRequest, errResp(err))
		default:
			c.JSON(http.StatusInternalServerError, errResp(err))
		}
		return
	}
	c.JSON(http.StatusCreated, sub)
}

func (h *SubscriptionHandler) Get(c *gin.Context) {
	sub, err := h.svc.GetByID(c.Request.Context(), c.Param("id"))
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			c.JSON(http.StatusNotFound, errResp(err))
			return
		}
		c.JSON(http.StatusInternalServerError, errResp(err))
		return
	}
	c.JSON(http.StatusOK, sub)
}

func (h *SubscriptionHandler) List(c *gin.Context) {
	orgID := c.GetHeader("X-Org-ID")
	var q domain.ListSubscriptionsQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		c.JSON(http.StatusBadRequest, errResp(err))
		return
	}

	subs, total, err := h.svc.List(c.Request.Context(), orgID, &q)
	if err != nil {
		c.JSON(http.StatusInternalServerError, errResp(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"subscriptions": subs, "total": total})
}

func (h *SubscriptionHandler) Approve(c *gin.Context) {
	approverID := c.GetHeader("X-User-ID")
	if err := h.svc.Approve(c.Request.Context(), c.Param("id"), approverID); err != nil {
		h.handleSubError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *SubscriptionHandler) Suspend(c *gin.Context) {
	if err := h.svc.Suspend(c.Request.Context(), c.Param("id")); err != nil {
		h.handleSubError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *SubscriptionHandler) Cancel(c *gin.Context) {
	if err := h.svc.Cancel(c.Request.Context(), c.Param("id")); err != nil {
		h.handleSubError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *SubscriptionHandler) ChangePlan(c *gin.Context) {
	var req domain.ChangePlanReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errResp(err))
		return
	}
	if err := h.svc.ChangePlan(c.Request.Context(), c.Param("id"), req.PlanID); err != nil {
		h.handleSubError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *SubscriptionHandler) handleSubError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		c.JSON(http.StatusNotFound, errResp(err))
	case errors.Is(err, domain.ErrInvalidStatus):
		c.JSON(http.StatusUnprocessableEntity, errResp(err))
	case errors.Is(err, domain.ErrPlanNotFound):
		c.JSON(http.StatusBadRequest, errResp(err))
	default:
		c.JSON(http.StatusInternalServerError, errResp(err))
	}
}
