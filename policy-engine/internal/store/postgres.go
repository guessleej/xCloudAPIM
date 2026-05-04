package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/xcloudapim/policy-engine/internal/domain"
)

// ChainStore PolicyChain 的 PostgreSQL 持久化層
type ChainStore struct {
	db *sqlx.DB
}

func NewChainStore(db *sqlx.DB) *ChainStore {
	return &ChainStore{db: db}
}

type chainRow struct {
	ID         string         `db:"id"`
	APIID      string         `db:"api_id"`
	Version    int64          `db:"version"`
	ETag       string         `db:"etag"`
	PoliciesJS []byte         `db:"policies_json"`
	CreatedAt  time.Time      `db:"created_at"`
	UpdatedAt  sql.NullTime   `db:"updated_at"`
}

// GetByAPIID 取得指定 API 的最新啟用 PolicyChain
func (s *ChainStore) GetByAPIID(ctx context.Context, apiID string) (*domain.PolicyChain, error) {
	const q = `
		SELECT pc.id, pc.api_id, pcv.version, pcv.etag,
		       pcv.snapshot_json AS policies_json,
		       pc.created_at, pc.updated_at
		FROM   policy_chains pc
		JOIN   policy_chain_versions pcv ON pcv.chain_id = pc.id
		WHERE  pc.api_id = $1
		  AND  pc.deleted_at IS NULL
		ORDER  BY pcv.version DESC
		LIMIT  1`

	var row chainRow
	if err := s.db.GetContext(ctx, &row, q, apiID); err != nil {
		return nil, fmt.Errorf("get chain by api_id %s: %w", apiID, err)
	}

	return unmarshalChain(row)
}

// GetByChainID 依 chain_id 取得指定版本快照
func (s *ChainStore) GetByChainID(ctx context.Context, chainID string, version int64) (*domain.PolicyChain, error) {
	const q = `
		SELECT pc.id, pc.api_id, pcv.version, pcv.etag,
		       pcv.snapshot_json AS policies_json,
		       pc.created_at, pc.updated_at
		FROM   policy_chains pc
		JOIN   policy_chain_versions pcv ON pcv.chain_id = pc.id
		WHERE  pc.id = $1 AND pcv.version = $2`

	var row chainRow
	if err := s.db.GetContext(ctx, &row, q, chainID, version); err != nil {
		return nil, fmt.Errorf("get chain %s v%d: %w", chainID, version, err)
	}

	return unmarshalChain(row)
}

// SaveVersion 將 PolicyChain 快照寫入 policy_chain_versions
func (s *ChainStore) SaveVersion(ctx context.Context, chain *domain.PolicyChain) error {
	snapshot, err := json.Marshal(chain.Policies)
	if err != nil {
		return err
	}
	const q = `
		INSERT INTO policy_chain_versions (chain_id, version, etag, snapshot_json, created_at)
		VALUES ($1, $2, $3, $4, NOW())
		ON CONFLICT (chain_id, version) DO UPDATE
		  SET snapshot_json = EXCLUDED.snapshot_json,
		      etag          = EXCLUDED.etag`

	_, err = s.db.ExecContext(ctx, q, chain.ID, chain.Version, chain.ETag, snapshot)
	return err
}

// ListUpdatedAfter 取得在 since 之後有更新的 chain（供 Gateway delta sync）
func (s *ChainStore) ListUpdatedAfter(ctx context.Context, since time.Time) ([]*domain.PolicyChain, error) {
	const q = `
		SELECT DISTINCT ON (pc.api_id)
		       pc.id, pc.api_id, pcv.version, pcv.etag,
		       pcv.snapshot_json AS policies_json,
		       pc.created_at, pc.updated_at
		FROM   policy_chains pc
		JOIN   policy_chain_versions pcv ON pcv.chain_id = pc.id
		WHERE  pc.updated_at > $1
		  AND  pc.deleted_at IS NULL
		ORDER  BY pc.api_id, pcv.version DESC`

	var rows []chainRow
	if err := s.db.SelectContext(ctx, &rows, q, since); err != nil {
		return nil, err
	}

	chains := make([]*domain.PolicyChain, 0, len(rows))
	for _, row := range rows {
		c, err := unmarshalChain(row)
		if err != nil {
			continue
		}
		chains = append(chains, c)
	}
	return chains, nil
}

// ─── Helpers ─────────────────────────────────────────────────

func unmarshalChain(row chainRow) (*domain.PolicyChain, error) {
	var policies []*domain.Policy
	if len(row.PoliciesJS) > 0 {
		if err := json.Unmarshal(row.PoliciesJS, &policies); err != nil {
			return nil, fmt.Errorf("unmarshal policies: %w", err)
		}
	}
	return &domain.PolicyChain{
		ID:       row.ID,
		APIID:    row.APIID,
		Version:  row.Version,
		ETag:     row.ETag,
		Policies: policies,
	}, nil
}
