package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/xcloudapim/registry-service/internal/domain"
	"go.uber.org/zap"
)

// ─── API Handlers ────────────────────────────────────────────

// ListAPIs GET /apis
func (h *Handlers) ListAPIs(c *gin.Context) {
	orgID, ok := requireOrgID(c)
	if !ok {
		return
	}

	var p domain.APIListParams
	if err := c.ShouldBindQuery(&p); err != nil {
		respondError(c, domain.ErrInvalidInput(err.Error()))
		return
	}

	result, err := h.apiService.ListAPIs(c.Request.Context(), orgID, &p)
	if err != nil {
		h.logger.Error("list apis failed", zap.Error(err))
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

// CreateAPI POST /apis
func (h *Handlers) CreateAPI(c *gin.Context) {
	orgID, ok := requireOrgID(c)
	if !ok {
		return
	}
	userID, ok := requireUserID(c)
	if !ok {
		return
	}

	var req domain.CreateAPIRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, domain.ErrInvalidInput(err.Error()))
		return
	}

	api, err := h.apiService.CreateAPI(c.Request.Context(), orgID, userID, &req)
	if err != nil {
		h.logger.Warn("create api failed", zap.Error(err))
		respondError(c, err)
		return
	}
	c.JSON(http.StatusCreated, api)
}

// GetAPI GET /apis/:id
func (h *Handlers) GetAPI(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}

	api, err := h.apiService.GetAPI(c.Request.Context(), id)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, api)
}

// UpdateAPI PUT /apis/:id
func (h *Handlers) UpdateAPI(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}

	var req domain.UpdateAPIRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, domain.ErrInvalidInput(err.Error()))
		return
	}

	api, err := h.apiService.UpdateAPI(c.Request.Context(), id, &req)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, api)
}

// DeleteAPI DELETE /apis/:id
func (h *Handlers) DeleteAPI(c *gin.Context) {
	id, ok := parseUUID(c, "id")
	if !ok {
		return
	}

	if err := h.apiService.DeleteAPI(c.Request.Context(), id); err != nil {
		respondError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// ─── Version Handlers ─────────────────────────────────────────

// ListVersions GET /apis/:id/versions
func (h *Handlers) ListVersions(c *gin.Context) {
	apiID, ok := parseUUID(c, "id")
	if !ok {
		return
	}

	versions, err := h.apiService.ListVersions(c.Request.Context(), apiID)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": versions, "total": len(versions)})
}

// CreateVersion POST /apis/:id/versions
func (h *Handlers) CreateVersion(c *gin.Context) {
	apiID, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	userID, ok := requireUserID(c)
	if !ok {
		return
	}

	var req domain.CreateVersionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, domain.ErrInvalidInput(err.Error()))
		return
	}

	v, err := h.apiService.CreateVersion(c.Request.Context(), apiID, userID, &req)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusCreated, v)
}

// GetVersion GET /apis/:id/versions/:version
func (h *Handlers) GetVersion(c *gin.Context) {
	apiID, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	versionStr := c.Param("version")

	v, err := h.apiService.GetVersion(c.Request.Context(), apiID, versionStr)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

// UpdateVersion PUT /apis/:id/versions/:version
func (h *Handlers) UpdateVersion(c *gin.Context) {
	apiID, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	versionStr := c.Param("version")

	var req domain.UpdateVersionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, domain.ErrInvalidInput(err.Error()))
		return
	}

	v, err := h.apiService.UpdateVersion(c.Request.Context(), apiID, versionStr, &req)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

// ─── Spec Handlers ────────────────────────────────────────────

// UploadSpec PUT /apis/:id/versions/:version/spec
func (h *Handlers) UploadSpec(c *gin.Context) {
	apiID, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	versionStr := c.Param("version")

	var req domain.UploadSpecRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, domain.ErrInvalidInput(err.Error()))
		return
	}

	summary, err := h.apiService.UploadSpec(c.Request.Context(), apiID, versionStr, &req)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "spec uploaded successfully",
		"summary": summary,
	})
}

// GetSpec GET /apis/:id/versions/:version/spec?format=yaml|json
func (h *Handlers) GetSpec(c *gin.Context) {
	apiID, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	versionStr := c.Param("version")
	format := c.DefaultQuery("format", "yaml")

	content, contentType, err := h.apiService.GetSpec(c.Request.Context(), apiID, versionStr, format)
	if err != nil {
		respondError(c, err)
		return
	}
	c.Data(http.StatusOK, contentType, []byte(content))
}

// GetLatestSpec GET /apis/:id/spec?format=yaml|json
func (h *Handlers) GetLatestSpec(c *gin.Context) {
	apiID, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	format := c.DefaultQuery("format", "yaml")

	content, contentType, err := h.apiService.GetSpec(c.Request.Context(), apiID, "latest", format)
	if err != nil {
		respondError(c, err)
		return
	}
	c.Data(http.StatusOK, contentType, []byte(content))
}

// ─── Lifecycle Handlers ───────────────────────────────────────

// PublishVersion POST /apis/:id/versions/:version/publish
func (h *Handlers) PublishVersion(c *gin.Context) {
	apiID, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	versionStr := c.Param("version")

	var req domain.PublishVersionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, domain.ErrInvalidInput(err.Error()))
		return
	}

	route, err := h.apiService.PublishVersion(c.Request.Context(), apiID, versionStr, &req)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message":       "version published successfully",
		"gateway_route": route,
	})
}

// DeprecateVersion POST /apis/:id/versions/:version/deprecate
func (h *Handlers) DeprecateVersion(c *gin.Context) {
	apiID, ok := parseUUID(c, "id")
	if !ok {
		return
	}
	versionStr := c.Param("version")

	var body struct {
		SunsetDate *string `json:"sunset_date"`
	}
	c.ShouldBindJSON(&body) //nolint:errcheck

	var sunsetDate *time.Time
	if body.SunsetDate != nil {
		t, err := time.Parse("2006-01-02", *body.SunsetDate)
		if err != nil {
			respondError(c, domain.ErrInvalidInput("sunset_date must be YYYY-MM-DD"))
			return
		}
		sunsetDate = &t
	}

	if err := h.apiService.DeprecateVersion(c.Request.Context(), apiID, versionStr, sunsetDate); err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "version deprecated"})
}

// ─── Gateway Route Handlers ───────────────────────────────────

// GetActiveRoutes GET /internal/routes
func (h *Handlers) GetActiveRoutes(c *gin.Context) {
	routes, err := h.apiService.GetActiveRoutes(c.Request.Context())
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"routes": routes, "count": len(routes)})
}

// GetRoutesDelta GET /internal/routes/delta?since=1713000000
func (h *Handlers) GetRoutesDelta(c *gin.Context) {
	sinceStr := c.Query("since")
	var since time.Time
	if sinceStr != "" {
		ts, err := strconv.ParseInt(sinceStr, 10, 64)
		if err != nil {
			respondError(c, domain.ErrInvalidInput("since must be a Unix timestamp"))
			return
		}
		since = time.Unix(ts, 0)
	} else {
		since = time.Now().Add(-5 * time.Minute)
	}

	routes, err := h.apiService.GetRoutesDelta(c.Request.Context(), since)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"routes": routes,
		"count":  len(routes),
		"since":  since.Unix(),
	})
}

// ─── Helpers ─────────────────────────────────────────────────

func parseUUID(c *gin.Context, param string) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param(param))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    "INVALID_UUID",
			"message": param + " must be a valid UUID",
		})
		return uuid.Nil, false
	}
	return id, true
}

func requireOrgID(c *gin.Context) (uuid.UUID, bool) {
	raw := c.GetHeader("X-Org-ID")
	if raw == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "MISSING_ORG_ID", "message": "X-Org-ID header is required"})
		return uuid.Nil, false
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_ORG_ID", "message": "X-Org-ID must be a valid UUID"})
		return uuid.Nil, false
	}
	return id, true
}

func requireUserID(c *gin.Context) (uuid.UUID, bool) {
	raw := c.GetHeader("X-User-ID")
	if raw == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "MISSING_USER_ID", "message": "X-User-ID header is required"})
		return uuid.Nil, false
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_USER_ID", "message": "X-User-ID must be a valid UUID"})
		return uuid.Nil, false
	}
	return id, true
}

func respondError(c *gin.Context, err error) {
	if svcErr, ok := err.(*domain.ServiceError); ok {
		c.JSON(svcErr.Status, svcErr)
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{
		"code":    "INTERNAL_ERROR",
		"message": "internal server error",
	})
}
