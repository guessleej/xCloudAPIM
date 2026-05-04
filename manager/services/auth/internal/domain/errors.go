package domain

import "errors"

// OAuth2 標準錯誤碼（RFC 6749）
type OAuthError struct {
	Code        string `json:"error"`
	Description string `json:"error_description,omitempty"`
	URI         string `json:"error_uri,omitempty"`
	HTTPStatus  int    `json:"-"`
}

func (e *OAuthError) Error() string {
	return e.Code + ": " + e.Description
}

func NewOAuthError(code, desc string, status int) *OAuthError {
	return &OAuthError{Code: code, Description: desc, HTTPStatus: status}
}

var (
	ErrInvalidRequest       = func(desc string) *OAuthError { return NewOAuthError("invalid_request", desc, 400) }
	ErrInvalidClient        = func(desc string) *OAuthError { return NewOAuthError("invalid_client", desc, 401) }
	ErrInvalidGrant         = func(desc string) *OAuthError { return NewOAuthError("invalid_grant", desc, 400) }
	ErrUnauthorizedClient   = func(desc string) *OAuthError { return NewOAuthError("unauthorized_client", desc, 403) }
	ErrUnsupportedGrantType = func(desc string) *OAuthError { return NewOAuthError("unsupported_grant_type", desc, 400) }
	ErrInvalidScope         = func(desc string) *OAuthError { return NewOAuthError("invalid_scope", desc, 400) }
	ErrServerError          = func(desc string) *OAuthError { return NewOAuthError("server_error", desc, 500) }
	ErrAccessDenied         = func(desc string) *OAuthError { return NewOAuthError("access_denied", desc, 403) }

	ErrClientNotFound      = errors.New("client not found")
	ErrUserNotFound        = errors.New("user not found")
	ErrCodeNotFound        = errors.New("authorization code not found")
	ErrCodeExpired         = errors.New("authorization code expired")
	ErrCodeUsed            = errors.New("authorization code already used")
	ErrTokenNotFound       = errors.New("token not found")
	ErrTokenExpired        = errors.New("token expired")
	ErrTokenRevoked        = errors.New("token revoked")
	ErrPKCEVerifyFailed    = errors.New("pkce code_verifier verification failed")
	ErrRedirectURIMismatch = errors.New("redirect_uri mismatch")
	ErrScopeNotAllowed     = errors.New("scope not allowed for this client")
)
