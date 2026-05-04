package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/xcloudapim/auth-service/internal/domain"
)

type ClientRepository struct {
	db *DB
}

func NewClientRepository(db *DB) *ClientRepository {
	return &ClientRepository{db: db}
}

// GetByClientID 透過 client_id 字串查詢 OAuthClient
func (r *ClientRepository) GetByClientID(ctx context.Context, clientID string) (*domain.OAuthClient, error) {
	const q = `
		SELECT
			oc.id, oc.client_id, oc.client_secret_hash, oc.client_name,
			oc.grant_types, oc.redirect_uris, oc.scopes,
			oc.token_endpoint_auth_method, oc.require_pkce,
			oc.access_token_ttl, oc.refresh_token_ttl, oc.active,
			oc.subscription_id,
			COALESCE(p.name::text, 'free') AS plan
		FROM oauth_clients oc
		LEFT JOIN subscriptions s  ON s.id = oc.subscription_id AND s.status = 'active'
		LEFT JOIN plans p          ON p.id = s.plan_id
		WHERE oc.client_id = $1 AND oc.active = TRUE
		LIMIT 1`

	type row struct {
		ID                      uuid.UUID      `db:"id"`
		ClientID                string         `db:"client_id"`
		ClientSecretHash        sql.NullString `db:"client_secret_hash"`
		ClientName              string         `db:"client_name"`
		GrantTypes              pq.StringArray `db:"grant_types"`
		RedirectURIs            pq.StringArray `db:"redirect_uris"`
		Scopes                  pq.StringArray `db:"scopes"`
		TokenEndpointAuthMethod string         `db:"token_endpoint_auth_method"`
		RequirePKCE             bool           `db:"require_pkce"`
		AccessTokenTTL          int            `db:"access_token_ttl"`
		RefreshTokenTTL         int            `db:"refresh_token_ttl"`
		Active                  bool           `db:"active"`
		SubscriptionID          uuid.NullUUID  `db:"subscription_id"`
		Plan                    string         `db:"plan"`
	}

	var r1 row
	if err := r.db.GetContext(ctx, &r1, q, clientID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, domain.ErrClientNotFound
		}
		return nil, fmt.Errorf("get client by client_id: %w", err)
	}

	client := &domain.OAuthClient{
		ID:                      r1.ID,
		ClientID:                r1.ClientID,
		ClientName:              r1.ClientName,
		GrantTypes:              []string(r1.GrantTypes),
		RedirectURIs:            []string(r1.RedirectURIs),
		Scopes:                  []string(r1.Scopes),
		TokenEndpointAuthMethod: r1.TokenEndpointAuthMethod,
		RequirePKCE:             r1.RequirePKCE,
		AccessTokenTTL:          r1.AccessTokenTTL,
		RefreshTokenTTL:         r1.RefreshTokenTTL,
		Active:                  r1.Active,
		Plan:                    r1.Plan,
	}
	if r1.ClientSecretHash.Valid {
		client.ClientSecretHash = &r1.ClientSecretHash.String
	}
	if r1.SubscriptionID.Valid {
		id := r1.SubscriptionID.UUID
		client.SubscriptionID = &id
	}
	return client, nil
}

// GetUserByEmail 查詢使用者（Authorization Code flow 中驗證身份）
func (r *ClientRepository) GetUserByEmail(ctx context.Context, email string) (*domain.User, error) {
	const q = `
		SELECT id, email, display_name,
		       (status = 'active' AND email_verified = TRUE) AS active
		FROM users
		WHERE email = $1 AND deleted_at IS NULL
		LIMIT 1`

	var u struct {
		ID          uuid.UUID `db:"id"`
		Email       string    `db:"email"`
		DisplayName string    `db:"display_name"`
		Active      bool      `db:"active"`
	}
	if err := r.db.GetContext(ctx, &u, q, email); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, domain.ErrUserNotFound
		}
		return nil, fmt.Errorf("get user by email: %w", err)
	}
	return &domain.User{
		ID:          u.ID,
		Email:       u.Email,
		DisplayName: u.DisplayName,
		Active:      u.Active,
	}, nil
}
