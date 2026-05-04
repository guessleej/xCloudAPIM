package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/xcloudapim/auth-service/internal/domain"
)

type TokenRepository struct {
	db *DB
}

func NewTokenRepository(db *DB) *TokenRepository {
	return &TokenRepository{db: db}
}

// CreateToken 將 Token 寫入 DB
func (r *TokenRepository) CreateToken(ctx context.Context, t *domain.Token) error {
	const q = `
		INSERT INTO oauth_tokens (
			id, token_hash, token_type, client_id, user_id,
			subscription_id, scopes, subject, audience,
			expires_at, issued_at, parent_token_id, ip_address
		) VALUES (
			$1, $2, $3::token_type, $4, $5,
			$6, $7, $8, $9,
			$10, $11, $12, $13
		)`

	_, err := r.db.ExecContext(ctx, q,
		t.ID, t.TokenHash, string(t.TokenType), t.ClientID, t.UserID,
		t.SubscriptionID, pq.Array(t.Scopes), t.Subject, pq.Array(t.Audience),
		t.ExpiresAt, t.IssuedAt, t.ParentTokenID, t.IPAddress,
	)
	if err != nil {
		return fmt.Errorf("create token: %w", err)
	}
	return nil
}

// GetByHash 透過 Token Hash 查詢
func (r *TokenRepository) GetByHash(ctx context.Context, hash string) (*domain.Token, error) {
	const q = `
		SELECT id, token_hash, token_type, client_id, user_id,
		       subscription_id, scopes, subject, audience,
		       expires_at, issued_at, revoked_at, revoke_reason, parent_token_id
		FROM oauth_tokens
		WHERE token_hash = $1
		LIMIT 1`

	type row struct {
		ID             uuid.UUID      `db:"id"`
		TokenHash      string         `db:"token_hash"`
		TokenType      string         `db:"token_type"`
		ClientID       uuid.UUID      `db:"client_id"`
		UserID         uuid.NullUUID  `db:"user_id"`
		SubscriptionID uuid.NullUUID  `db:"subscription_id"`
		Scopes         pq.StringArray `db:"scopes"`
		Subject        string         `db:"subject"`
		Audience       pq.StringArray `db:"audience"`
		ExpiresAt      time.Time      `db:"expires_at"`
		IssuedAt       time.Time      `db:"issued_at"`
		RevokedAt      sql.NullTime   `db:"revoked_at"`
		RevokeReason   string         `db:"revoke_reason"`
		ParentTokenID  uuid.NullUUID  `db:"parent_token_id"`
	}

	var r1 row
	if err := r.db.GetContext(ctx, &r1, q, hash); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, domain.ErrTokenNotFound
		}
		return nil, fmt.Errorf("get token by hash: %w", err)
	}

	t := &domain.Token{
		ID:           r1.ID,
		TokenHash:    r1.TokenHash,
		TokenType:    domain.TokenType(r1.TokenType),
		ClientID:     r1.ClientID,
		Scopes:       []string(r1.Scopes),
		Subject:      r1.Subject,
		Audience:     []string(r1.Audience),
		ExpiresAt:    r1.ExpiresAt,
		IssuedAt:     r1.IssuedAt,
		RevokeReason: r1.RevokeReason,
	}
	if r1.UserID.Valid {
		id := r1.UserID.UUID
		t.UserID = &id
	}
	if r1.SubscriptionID.Valid {
		id := r1.SubscriptionID.UUID
		t.SubscriptionID = &id
	}
	if r1.RevokedAt.Valid {
		t.RevokedAt = &r1.RevokedAt.Time
	}
	if r1.ParentTokenID.Valid {
		id := r1.ParentTokenID.UUID
		t.ParentTokenID = &id
	}
	return t, nil
}

// RevokeToken 撤銷指定 Token
func (r *TokenRepository) RevokeToken(ctx context.Context, tokenHash, reason string) error {
	const q = `
		UPDATE oauth_tokens
		SET revoked_at = NOW(), revoke_reason = $2
		WHERE token_hash = $1 AND revoked_at IS NULL`

	res, err := r.db.ExecContext(ctx, q, tokenHash, reason)
	if err != nil {
		return fmt.Errorf("revoke token: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return domain.ErrTokenNotFound
	}
	return nil
}

// RevokeAllClientTokens 撤銷某 Client 的所有有效 Token
func (r *TokenRepository) RevokeAllClientTokens(ctx context.Context, clientUUID uuid.UUID, reason string) (int64, error) {
	const q = `
		UPDATE oauth_tokens
		SET revoked_at = NOW(), revoke_reason = $2
		WHERE client_id = $1 AND revoked_at IS NULL AND expires_at > NOW()`

	res, err := r.db.ExecContext(ctx, q, clientUUID, reason)
	if err != nil {
		return 0, fmt.Errorf("revoke all client tokens: %w", err)
	}
	n, _ := res.RowsAffected()
	return n, nil
}

// UpdateLastUsed 更新 Token 最後使用時間
func (r *TokenRepository) UpdateLastUsed(ctx context.Context, tokenHash, ip string) {
	const q = `
		UPDATE oauth_tokens
		SET last_used_at = NOW(), last_used_ip = $2, use_count = use_count + 1
		WHERE token_hash = $1`
	// best-effort, ignore error
	r.db.ExecContext(ctx, q, tokenHash, ip) //nolint:errcheck
}
