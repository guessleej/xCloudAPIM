package domain

import (
	"time"

	"github.com/google/uuid"
)

// ─── OAuth2 Client ────────────────────────────────────────────
type OAuthClient struct {
	ID                      uuid.UUID
	ClientID                string
	ClientSecretHash        *string
	ClientName              string
	GrantTypes              []string
	RedirectURIs            []string
	Scopes                  []string
	TokenEndpointAuthMethod string
	RequirePKCE             bool
	AccessTokenTTL          int
	RefreshTokenTTL         int
	Active                  bool
	Plan                    string
	SubscriptionID          *uuid.UUID
}

func (c *OAuthClient) HasGrantType(gt string) bool {
	for _, g := range c.GrantTypes {
		if g == gt {
			return true
		}
	}
	return false
}

func (c *OAuthClient) HasScope(scope string) bool {
	for _, s := range c.Scopes {
		if s == scope {
			return true
		}
	}
	return false
}

func (c *OAuthClient) HasRedirectURI(uri string) bool {
	for _, u := range c.RedirectURIs {
		if u == uri {
			return true
		}
	}
	return false
}

// ─── Authorization Code ───────────────────────────────────────
type AuthorizationCode struct {
	Code                string
	ClientID            uuid.UUID
	UserID              uuid.UUID
	RedirectURI         string
	Scopes              []string
	CodeChallenge       string
	CodeChallengeMethod string
	Nonce               string
	ExpiresAt           time.Time
	Used                bool
}

// ─── Token ────────────────────────────────────────────────────
type Token struct {
	ID             uuid.UUID
	TokenHash      string
	TokenType      TokenType
	ClientID       uuid.UUID
	UserID         *uuid.UUID
	SubscriptionID *uuid.UUID
	Scopes         []string
	Subject        string
	Audience       []string
	ExpiresAt      time.Time
	IssuedAt       time.Time
	RevokedAt      *time.Time
	RevokeReason   string
	ParentTokenID  *uuid.UUID
	IPAddress      string
}

type TokenType string

const (
	TokenTypeAccess    TokenType = "access_token"
	TokenTypeRefresh   TokenType = "refresh_token"
	TokenTypeIDToken   TokenType = "id_token"
)

func (t *Token) IsExpired() bool {
	return time.Now().After(t.ExpiresAt)
}

func (t *Token) IsRevoked() bool {
	return t.RevokedAt != nil
}

func (t *Token) IsValid() bool {
	return !t.IsExpired() && !t.IsRevoked()
}

// ─── Token Response ───────────────────────────────────────────
type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token,omitempty"`
	IDToken      string `json:"id_token,omitempty"`
	Scope        string `json:"scope"`
}

// ─── JWT Claims ───────────────────────────────────────────────
type JWTClaims struct {
	Subject        string   `json:"sub"`
	ClientID       string   `json:"client_id"`
	Scopes         []string `json:"scopes"`
	Plan           string   `json:"plan,omitempty"`
	SubscriptionID string   `json:"sub_id,omitempty"`
	Issuer         string   `json:"iss"`
	Audience       []string `json:"aud"`
	ExpiresAt      int64    `json:"exp"`
	IssuedAt       int64    `json:"iat"`
	JWTID          string   `json:"jti"`
	Nonce          string   `json:"nonce,omitempty"`
}

// ─── JWKS ─────────────────────────────────────────────────────
type JWKS struct {
	Keys []JWK `json:"keys"`
}

type JWK struct {
	KeyType   string `json:"kty"`
	Use       string `json:"use"`
	KeyID     string `json:"kid"`
	Algorithm string `json:"alg"`
	N         string `json:"n"`
	E         string `json:"e"`
}

// ─── User ─────────────────────────────────────────────────────
type User struct {
	ID          uuid.UUID
	Email       string
	DisplayName string
	Active      bool
}

// ─── Grant Types ─────────────────────────────────────────────
const (
	GrantTypeAuthorizationCode = "authorization_code"
	GrantTypeClientCredentials = "client_credentials"
	GrantTypeRefreshToken      = "refresh_token"
)

// ─── Token Request ────────────────────────────────────────────
type TokenRequest struct {
	GrantType    string
	Code         string
	RedirectURI  string
	ClientID     string
	ClientSecret string
	CodeVerifier string
	RefreshToken string
	Scope        string
}

// ─── Authorize Request ────────────────────────────────────────
type AuthorizeRequest struct {
	ResponseType        string
	ClientID            string
	RedirectURI         string
	Scope               string
	State               string
	Nonce               string
	CodeChallenge       string
	CodeChallengeMethod string
}
