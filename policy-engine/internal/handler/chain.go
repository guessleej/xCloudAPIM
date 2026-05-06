package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/xcloudapim/policy-engine/internal/domain"
	"go.uber.org/zap"
)

// ─── Gateway endpoint ─────────────────────────────────────────

func (h *Handlers) GetGatewayChain(c *gin.Context) {
	apiID := c.Param("apiId")
	if apiID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "api_id is required"})
		return
	}

	chain, err := h.chainSvc.GetGatewayChain(c.Request.Context(), apiID)
	if err != nil {
		if errors.Is(err, domain.ErrChainNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "no published chain for this api"})
			return
		}
		h.logger.Error("GetGatewayChain failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	// ETag support: 304 Not Modified when cache is fresh
	if c.GetHeader("If-None-Match") == chain.ETag {
		c.Status(http.StatusNotModified)
		return
	}
	c.Header("ETag", chain.ETag)
	c.JSON(http.StatusOK, chain)
}

func (h *Handlers) InvalidateCache(c *gin.Context) {
	var req domain.InvalidateCacheRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.chainSvc.InvalidateCache(c.Request.Context(), req.APIID); err != nil {
		h.logger.Error("InvalidateCache failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "invalidated", "api_id": req.APIID})
}

// ─── Chain CRUD ───────────────────────────────────────────────

func (h *Handlers) ListChains(c *gin.Context) {
	orgID := c.GetHeader("X-Org-ID")
	if orgID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "X-Org-ID header is required"})
		return
	}
	chains, err := h.chainSvc.ListChains(c.Request.Context(), orgID)
	if err != nil {
		h.logger.Error("ListChains", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": chains, "total": len(chains)})
}

func (h *Handlers) GetChain(c *gin.Context) {
	chain, err := h.chainSvc.GetChain(c.Request.Context(), c.Param("id"))
	if err != nil {
		if errors.Is(err, domain.ErrChainNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "chain not found"})
			return
		}
		h.logger.Error("GetChain", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, chain)
}

func (h *Handlers) CreateChain(c *gin.Context) {
	orgID := c.GetHeader("X-Org-ID")
	userID := c.GetHeader("X-User-ID")
	if orgID == "" || userID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "X-Org-ID and X-User-ID headers are required"})
		return
	}
	var req domain.CreateChainRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	chain, err := h.chainSvc.CreateChain(c.Request.Context(), &req, orgID, userID)
	if err != nil {
		h.logger.Error("CreateChain", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusCreated, chain)
}

func (h *Handlers) UpdateChain(c *gin.Context) {
	var req domain.UpdateChainRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	chain, err := h.chainSvc.UpdateChain(c.Request.Context(), c.Param("id"), &req)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrChainNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "chain not found"})
		case errors.Is(err, domain.ErrChainNotDraft):
			c.JSON(http.StatusConflict, gin.H{"error": "only draft chains can be modified"})
		default:
			h.logger.Error("UpdateChain", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		}
		return
	}
	c.JSON(http.StatusOK, chain)
}

func (h *Handlers) PublishChain(c *gin.Context) {
	userID := c.GetHeader("X-User-ID")
	var req domain.PublishChainRequest
	_ = c.ShouldBindJSON(&req)

	chain, err := h.chainSvc.PublishChain(c.Request.Context(), c.Param("id"), userID, &req)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrChainNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "chain not found"})
		case errors.Is(err, domain.ErrChainAlreadyPublished):
			c.JSON(http.StatusConflict, gin.H{"error": "chain is already published"})
		default:
			h.logger.Error("PublishChain", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		}
		return
	}
	c.JSON(http.StatusOK, chain)
}

func (h *Handlers) DeleteChain(c *gin.Context) {
	if err := h.chainSvc.DeleteChain(c.Request.Context(), c.Param("id")); err != nil {
		switch {
		case errors.Is(err, domain.ErrChainNotDraft):
			c.JSON(http.StatusConflict, gin.H{"error": "only draft chains can be deleted"})
		default:
			h.logger.Error("DeleteChain", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		}
		return
	}
	c.Status(http.StatusNoContent)
}

// ─── Policy CRUD ──────────────────────────────────────────────

func (h *Handlers) ListPolicies(c *gin.Context) {
	policies, err := h.chainSvc.ListPolicies(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.logger.Error("ListPolicies", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": policies, "total": len(policies)})
}

func (h *Handlers) CreatePolicy(c *gin.Context) {
	var req domain.CreatePolicyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	policy, err := h.chainSvc.CreatePolicy(c.Request.Context(), c.Param("id"), &req)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrChainNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "chain not found"})
		case errors.Is(err, domain.ErrChainNotDraft):
			c.JSON(http.StatusConflict, gin.H{"error": "only draft chains can be modified"})
		default:
			h.logger.Error("CreatePolicy", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		}
		return
	}
	c.JSON(http.StatusCreated, policy)
}

func (h *Handlers) UpdatePolicy(c *gin.Context) {
	var req domain.UpdatePolicyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.chainSvc.UpdatePolicy(c.Request.Context(), c.Param("id"), c.Param("policyId"), &req); err != nil {
		switch {
		case errors.Is(err, domain.ErrPolicyNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "policy not found"})
		case errors.Is(err, domain.ErrChainNotDraft):
			c.JSON(http.StatusConflict, gin.H{"error": "only draft chains can be modified"})
		default:
			h.logger.Error("UpdatePolicy", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		}
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handlers) DeletePolicy(c *gin.Context) {
	if err := h.chainSvc.DeletePolicy(c.Request.Context(), c.Param("id"), c.Param("policyId")); err != nil {
		switch {
		case errors.Is(err, domain.ErrChainNotDraft):
			c.JSON(http.StatusConflict, gin.H{"error": "only draft chains can be modified"})
		default:
			h.logger.Error("DeletePolicy", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		}
		return
	}
	c.Status(http.StatusNoContent)
}

// ─── Templates ────────────────────────────────────────────────

func (h *Handlers) ListTemplates(c *gin.Context) {
	templates, err := h.chainSvc.ListTemplates(c.Request.Context())
	if err != nil {
		h.logger.Error("ListTemplates", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": templates, "total": len(templates)})
}
