package repository

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/lib/pq"
	"github.com/xcloudapim/subscription-service/internal/domain"
)

type APIKeyRepo struct {
	db *sqlx.DB
}

func NewAPIKeyRepo(db *sqlx.DB) *APIKeyRepo {
	return &APIKeyRepo{db: db}
}

type apiKeyRow struct {
	ID             string         `db:"id"`
	SubscriptionID string         `db:"subscription_id"`
	OrganizationID string         `db:"organization_id"`
	KeyHash        string         `db:"key_hash"`
	KeyPrefix      string         `db:"key_prefix"`
	Name           string         `db:"name"`
	Description    sql.NullString `db:"description"`
	Status         string         `db:"status"`
	AllowedIPs     pq.StringArray `db:"allowed_ips"`
	AllowedOrigins pq.StringArray `db:"allowed_origins"`
	Scopes         pq.StringArray `db:"scopes"`
	ExpiresAt      sql.NullTime   `db:"expires_at"`
	LastUsedAt     sql.NullTime   `db:"last_used_at"`
	CreatedBy      string         `db:"created_by"`
	RevokedBy      sql.NullString `db:"revoked_by"`
	RevokedAt      sql.NullTime   `db:"revoked_at"`
	RevokeReason   sql.NullString `db:"revoke_reason"`
	CreatedAt      time.Time      `db:"created_at"`
	UpdatedAt      time.Time      `db:"updated_at"`
}

func (r *APIKeyRepo) Create(ctx context.Context, key *domain.APIKey) error {
	const q = `
		INSERT INTO api_keys
		    (id, subscription_id, organization_id, key_hash, key_prefix, name, description,
		     status, allowed_ips, allowed_origins, scopes, expires_at, created_by, created_at, updated_at)
		VALUES
		    ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`

	now := time.Now()
	key.CreatedAt = now
	key.UpdatedAt = now

	_, err := r.db.ExecContext(ctx, q,
		key.ID, key.SubscriptionID, key.OrganizationID,
		key.KeyHash, key.KeyPrefix, key.Name,
		nullString(key.Description),
		key.Status,
		pq.Array(key.AllowedIPs),
		pq.Array(key.AllowedOrigins),
		pq.Array(key.Scopes),
		nullTime(key.ExpiresAt),
		key.CreatedBy, now, now,
	)
	return err
}

func (r *APIKeyRepo) GetByHash(ctx context.Context, hash string) (*domain.APIKey, error) {
	const q = `
		SELECT id, subscription_id, organization_id, key_hash, key_prefix, name, description,
		       status, allowed_ips, allowed_origins, scopes, expires_at, last_used_at,
		       created_by, revoked_by, revoked_at, revoke_reason, created_at, updated_at
		FROM   api_keys
		WHERE  key_hash = $1`

	var row apiKeyRow
	if err := r.db.GetContext(ctx, &row, q, hash); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, domain.ErrAPIKeyNotFound
		}
		return nil, err
	}
	return mapAPIKey(row), nil
}

func (r *APIKeyRepo) ListBySubscription(ctx context.Context, subID string) ([]*domain.APIKey, error) {
	const q = `
		SELECT id, subscription_id, organization_id, key_hash, key_prefix, name, description,
		       status, allowed_ips, allowed_origins, scopes, expires_at, last_used_at,
		       created_by, revoked_by, revoked_at, revoke_reason, created_at, updated_at
		FROM   api_keys
		WHERE  subscription_id = $1
		ORDER  BY created_at DESC`

	var rows []apiKeyRow
	if err := r.db.SelectContext(ctx, &rows, q, subID); err != nil {
		return nil, err
	}
	out := make([]*domain.APIKey, len(rows))
	for i, row := range rows {
		out[i] = mapAPIKey(row)
	}
	return out, nil
}

func (r *APIKeyRepo) CountActiveBySubscription(ctx context.Context, subID string) (int, error) {
	var count int
	const q = `SELECT COUNT(*) FROM api_keys WHERE subscription_id=$1 AND status='active'`
	err := r.db.GetContext(ctx, &count, q, subID)
	return count, err
}

func (r *APIKeyRepo) Revoke(ctx context.Context, keyID, revokedBy, reason string) error {
	const q = `
		UPDATE api_keys
		SET    status='revoked', revoked_by=$1, revoked_at=NOW(), revoke_reason=$2, updated_at=NOW()
		WHERE  id=$3 AND status='active'`

	res, err := r.db.ExecContext(ctx, q, revokedBy, reason, keyID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return domain.ErrAPIKeyNotFound
	}
	return nil
}

func (r *APIKeyRepo) UpdateLastUsed(ctx context.Context, id, ip string) error {
	const q = `UPDATE api_keys SET last_used_at=NOW(), last_used_ip=$1, updated_at=NOW() WHERE id=$2`
	_, err := r.db.ExecContext(ctx, q, ip, id)
	return err
}

// ─── helpers ─────────────────────────────────────────────────

func mapAPIKey(row apiKeyRow) *domain.APIKey {
	k := &domain.APIKey{
		ID:             row.ID,
		SubscriptionID: row.SubscriptionID,
		OrganizationID: row.OrganizationID,
		KeyHash:        row.KeyHash,
		KeyPrefix:      row.KeyPrefix,
		Name:           row.Name,
		Status:         domain.APIKeyStatus(row.Status),
		AllowedIPs:     []string(row.AllowedIPs),
		AllowedOrigins: []string(row.AllowedOrigins),
		Scopes:         []string(row.Scopes),
		CreatedBy:      row.CreatedBy,
		CreatedAt:      row.CreatedAt,
		UpdatedAt:      row.UpdatedAt,
	}
	if row.Description.Valid {
		k.Description = row.Description.String
	}
	if row.ExpiresAt.Valid {
		k.ExpiresAt = &row.ExpiresAt.Time
	}
	if row.LastUsedAt.Valid {
		k.LastUsedAt = &row.LastUsedAt.Time
	}
	if row.RevokedBy.Valid {
		k.RevokedBy = &row.RevokedBy.String
	}
	if row.RevokedAt.Valid {
		k.RevokedAt = &row.RevokedAt.Time
	}
	if row.RevokeReason.Valid {
		k.RevokeReason = &row.RevokeReason.String
	}
	return k
}

func nullString(s string) sql.NullString {
	return sql.NullString{String: s, Valid: s != ""}
}

func nullTime(t *time.Time) sql.NullTime {
	if t == nil {
		return sql.NullTime{}
	}
	return sql.NullTime{Time: *t, Valid: true}
}
