package domain

import (
	"errors"
	"fmt"
	"net/http"
)

// ServiceError 統一服務錯誤結構
type ServiceError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Detail  string `json:"detail,omitempty"`
	Status  int    `json:"-"`
}

func (e *ServiceError) Error() string { return fmt.Sprintf("[%s] %s", e.Code, e.Message) }

func newErr(status int, code, msg string) *ServiceError {
	return &ServiceError{Status: status, Code: code, Message: msg}
}

// 預定義錯誤
var (
	ErrAPINotFound      = newErr(http.StatusNotFound, "API_NOT_FOUND", "API not found")
	ErrVersionNotFound  = newErr(http.StatusNotFound, "VERSION_NOT_FOUND", "API version not found")
	ErrRouteNotFound    = newErr(http.StatusNotFound, "ROUTE_NOT_FOUND", "Gateway route not found")
	ErrSlugConflict     = newErr(http.StatusConflict, "SLUG_CONFLICT", "API slug already exists in this organization")
	ErrVersionConflict  = newErr(http.StatusConflict, "VERSION_CONFLICT", "This version already exists for the API")
	ErrSpecInvalid      = newErr(http.StatusBadRequest, "SPEC_INVALID", "OpenAPI spec is invalid")
	ErrSpecParseFailed  = newErr(http.StatusBadRequest, "SPEC_PARSE_FAILED", "Failed to parse OpenAPI spec")
	ErrCannotDeletePublished = newErr(http.StatusBadRequest, "CANNOT_DELETE_PUBLISHED", "Cannot delete a published API; deprecate it first")
	ErrVersionNotDraft  = newErr(http.StatusBadRequest, "VERSION_NOT_DRAFT", "Only draft versions can be published")
	ErrNoActiveVersion  = newErr(http.StatusNotFound, "NO_ACTIVE_VERSION", "API has no active (published) version")
	ErrUnauthorized     = newErr(http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
	ErrForbidden        = newErr(http.StatusForbidden, "FORBIDDEN", "Access denied")
)

func ErrInvalidInput(detail string) *ServiceError {
	return &ServiceError{Status: http.StatusBadRequest, Code: "INVALID_INPUT", Message: "Validation failed", Detail: detail}
}

func ErrInternal(detail string) *ServiceError {
	return &ServiceError{Status: http.StatusInternalServerError, Code: "INTERNAL_ERROR", Message: "Internal server error", Detail: detail}
}

// IsNotFound 判斷是否為 404 錯誤
func IsNotFound(err error) bool {
	var svcErr *ServiceError
	if errors.As(err, &svcErr) {
		return svcErr.Status == http.StatusNotFound
	}
	return false
}
