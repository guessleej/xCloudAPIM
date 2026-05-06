package repository

// ManagementRepo 管理側 CRUD（policy_chains + policies 表）
// 與 store 層分離：store 負責 Gateway 讀取路徑（policy_chain_versions 快照），
// ManagementRepo 負責管理 API 的 CRUD。

import (
	"context"
	"crypto/md5"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/xcloudapim/policy-engine/internal/domain"
	"go.uber.org/zap"
)

// ManagementChain is the management-side view of a policy chain
// (includes org/user metadata, unlike the read-side domain.PolicyChain).
type ManagementChain struct {
	ID             string    `json:"id"             db:"id"`
	OrganizationID string    `json:"organization_id" db:"organization_id"`
	APIID          *string   `json:"api_id,omitempty" db:"api_id"`
	Name           string    `json:"name"           db:"name"`
	Description    string    `json:"description"    db:"description"`
	Status         string    `json:"status"         db:"status"`
	Version        int       `json:"version"        db:"version"`
	CreatedBy      string    `json:"created_by"     db:"created_by"`
	CreatedAt      string    `json:"created_at"     db:"created_at"`
	UpdatedAt      string    `json:"updated_at"     db:"updated_at"`
	// Populated on get
	Policies []domain.Policy `json:"policies,omitempty" db:"-"`
}

type ManagementRepo struct {
	db     *DB
	logger *zap.Logger
}

func NewManagementRepo(db *DB, logger *zap.Logger) *ManagementRepo {
	return &ManagementRepo{db: db, logger: logger}
}

// ─── Chain CRUD ───────────────────────────────────────────────

func (r *ManagementRepo) ListByOrg(ctx context.Context, orgID string) ([]*ManagementChain, error) {
	var chains []*ManagementChain
	err := r.db.SelectContext(ctx, &chains, `
		SELECT id, organization_id, api_id, name, description, status, version,
		       created_by, created_at::text, updated_at::text
		FROM policy_chains
		WHERE organization_id = $1 AND deleted_at IS NULL
		ORDER BY updated_at DESC`, orgID)
	if err != nil {
		return nil, fmt.Errorf("list chains: %w", err)
	}
	return chains, nil
}

func (r *ManagementRepo) GetByID(ctx context.Context, id string) (*ManagementChain, error) {
	chain := &ManagementChain{}
	err := r.db.GetContext(ctx, chain, `
		SELECT id, organization_id, api_id, name, description, status, version,
		       created_by, created_at::text, updated_at::text
		FROM policy_chains
		WHERE id = $1 AND deleted_at IS NULL`, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, domain.ErrChainNotFound
		}
		return nil, fmt.Errorf("get chain: %w", err)
	}
	return chain, nil
}

func (r *ManagementRepo) Create(ctx context.Context, orgID, name, description, apiID, userID string) (*ManagementChain, error) {
	id := uuid.New().String()
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO policy_chains (id, organization_id, api_id, name, description, status, version, created_by)
		VALUES ($1, $2, $3, $4, $5, 'draft', 1, $6)`,
		id, orgID, nullString(apiID), name, description, userID,
	)
	if err != nil {
		return nil, fmt.Errorf("create chain: %w", err)
	}
	return r.GetByID(ctx, id)
}

func (r *ManagementRepo) Update(ctx context.Context, id, name, description string) error {
	result, err := r.db.ExecContext(ctx, `
		UPDATE policy_chains
		SET name = $2, description = $3, updated_at = NOW()
		WHERE id = $1 AND status = 'draft' AND deleted_at IS NULL`,
		id, name, description,
	)
	if err != nil {
		return fmt.Errorf("update chain: %w", err)
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return domain.ErrChainNotDraft
	}
	return nil
}

// Publish bumps version, creates a policy_chain_versions snapshot, marks chain as published.
func (r *ManagementRepo) Publish(ctx context.Context, id, userID, changeSummary string) error {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	// Fetch and lock chain
	var status string
	var version int
	var apiIDStr sql.NullString
	err = tx.QueryRowContext(ctx,
		`SELECT status, version, api_id FROM policy_chains WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, id).
		Scan(&status, &version, &apiIDStr)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.ErrChainNotFound
		}
		return fmt.Errorf("lock chain: %w", err)
	}
	if status == "published" {
		return domain.ErrChainAlreadyPublished
	}

	// Collect policies
	var policies []domain.Policy
	if err := tx.SelectContext(ctx, &policies, `
		SELECT id, chain_id, type, phase, exec_order AS "order", name, description, enabled,
		       config::text, condition_expr AS condition
		FROM policies WHERE chain_id = $1 ORDER BY exec_order`, id); err != nil {
		return fmt.Errorf("fetch policies: %w", err)
	}

	// Build lightweight domain.Policy slice for snapshot
	gwPolicies := make([]*domain.Policy, 0, len(policies))
	for i := range policies {
		gwPolicies = append(gwPolicies, &domain.Policy{
			ID:        policies[i].ID,
			Type:      domain.PolicyType(policies[i].Type),
			Phase:     domain.PolicyPhase(policies[i].Phase),
			Order:     policies[i].Order,
			Enabled:   policies[i].Enabled,
			Config:    policies[i].Config,
			Condition: policies[i].Condition,
		})
	}
	snapshot, _ := json.Marshal(gwPolicies)

	newVersion := int64(version + 1)
	etag := fmt.Sprintf("%x", md5.Sum(snapshot))

	// Archive previous published chain for this API
	if apiIDStr.Valid && apiIDStr.String != "" {
		_, _ = tx.ExecContext(ctx, `
			UPDATE policy_chains SET status = 'archived', updated_at = NOW()
			WHERE api_id = $1 AND status = 'published' AND id != $2 AND deleted_at IS NULL`,
			apiIDStr.String, id,
		)
	}

	// Write snapshot
	_, err = tx.ExecContext(ctx, `
		INSERT INTO policy_chain_versions (chain_id, version, etag, snapshot_json, change_summary, created_by)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (chain_id, version) DO UPDATE
		  SET snapshot_json = EXCLUDED.snapshot_json, etag = EXCLUDED.etag`,
		id, newVersion, etag, snapshot, changeSummary, nullString(userID),
	)
	if err != nil {
		return fmt.Errorf("write snapshot: %w", err)
	}

	// Update chain status
	_, err = tx.ExecContext(ctx, `
		UPDATE policy_chains
		SET status = 'published', version = $2, published_at = NOW(), published_by = $3, updated_at = NOW()
		WHERE id = $1`,
		id, newVersion, nullString(userID),
	)
	if err != nil {
		return fmt.Errorf("update chain status: %w", err)
	}

	return tx.Commit()
}

func (r *ManagementRepo) SoftDelete(ctx context.Context, id string) error {
	result, err := r.db.ExecContext(ctx, `
		UPDATE policy_chains SET deleted_at = NOW()
		WHERE id = $1 AND status = 'draft' AND deleted_at IS NULL`, id)
	if err != nil {
		return fmt.Errorf("soft delete: %w", err)
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return domain.ErrChainNotDraft
	}
	return nil
}

// ─── Policy CRUD ──────────────────────────────────────────────

func (r *ManagementRepo) ListPolicies(ctx context.Context, chainID string) ([]domain.Policy, error) {
	var rows []policyRow
	err := r.db.SelectContext(ctx, &rows, `
		SELECT id, chain_id::text, type::text, phase::text, exec_order, name, description, enabled, config::text, condition_expr
		FROM policies WHERE chain_id = $1 ORDER BY exec_order`, chainID)
	if err != nil {
		return nil, fmt.Errorf("list policies: %w", err)
	}
	return toPolDomains(rows), nil
}

func (r *ManagementRepo) GetPolicy(ctx context.Context, policyID string) (*domain.Policy, error) {
	var row policyRow
	err := r.db.GetContext(ctx, &row, `
		SELECT id, chain_id::text, type::text, phase::text, exec_order, name, description, enabled, config::text, condition_expr
		FROM policies WHERE id = $1`, policyID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, domain.ErrPolicyNotFound
		}
		return nil, fmt.Errorf("get policy: %w", err)
	}
	p := toPolDomain(row)
	return &p, nil
}

func (r *ManagementRepo) CreatePolicy(ctx context.Context, chainID string, req *domain.CreatePolicyRequest) (*domain.Policy, error) {
	id := uuid.New().String()
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	config := req.Config
	if config == nil {
		config = map[string]string{}
	}
	configJSON, _ := json.Marshal(config)
	condArg := nullString(req.Condition)

	_, err := r.db.ExecContext(ctx, `
		INSERT INTO policies (id, chain_id, type, phase, exec_order, name, description, enabled, config, condition_expr)
		VALUES ($1, $2, $3::policy_type, $4::policy_phase, $5, $6, '', $7, $8::jsonb, $9)`,
		id, chainID, string(req.Type), string(req.Phase), req.Order, req.Name, enabled, string(configJSON), condArg,
	)
	if err != nil {
		return nil, fmt.Errorf("create policy: %w", err)
	}
	return r.GetPolicy(ctx, id)
}

func (r *ManagementRepo) UpdatePolicy(ctx context.Context, policyID string, req *domain.UpdatePolicyRequest) error {
	existing, err := r.GetPolicy(ctx, policyID)
	if err != nil {
		return err
	}
	if req.Type != nil {
		existing.Type = *req.Type
	}
	if req.Phase != nil {
		existing.Phase = *req.Phase
	}
	if req.Order != nil {
		existing.Order = *req.Order
	}
	if req.Enabled != nil {
		existing.Enabled = *req.Enabled
	}
	if req.Config != nil {
		existing.Config = req.Config
	}
	if req.Condition != nil {
		existing.Condition = *req.Condition
	}

	newName := existing.ID // fallback to ID (no name field on Policy)
	if req.Name != nil {
		newName = *req.Name
	}

	configJSON, _ := json.Marshal(existing.Config)
	_, err = r.db.ExecContext(ctx, `
		UPDATE policies
		SET type = $2::policy_type, phase = $3::policy_phase, exec_order = $4,
		    name = $5, enabled = $6, config = $7::jsonb, condition_expr = $8, updated_at = NOW()
		WHERE id = $1`,
		policyID, string(existing.Type), string(existing.Phase), existing.Order,
		newName, existing.Enabled, string(configJSON), nullString(existing.Condition),
	)
	return err
}

func (r *ManagementRepo) DeletePolicy(ctx context.Context, policyID string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM policies WHERE id = $1`, policyID)
	return err
}

// ─── Helpers ─────────────────────────────────────────────────

type policyRow struct {
	ID          string   `db:"id"`
	ChainID     string   `db:"chain_id"`
	Type        string   `db:"type"`
	Phase       string   `db:"phase"`
	ExecOrder   int      `db:"exec_order"`
	Name        string   `db:"name"`
	Description string   `db:"description"`
	Enabled     bool     `db:"enabled"`
	Config      string   `db:"config"`
	ConditionExpr *string `db:"condition_expr"`
}

func toPolDomain(row policyRow) domain.Policy {
	var config map[string]string
	_ = json.Unmarshal([]byte(row.Config), &config)
	cond := ""
	if row.ConditionExpr != nil {
		cond = *row.ConditionExpr
	}
	return domain.Policy{
		ID:        row.ID,
		Type:      domain.PolicyType(row.Type),
		Phase:     domain.PolicyPhase(row.Phase),
		Order:     row.ExecOrder,
		Enabled:   row.Enabled,
		Config:    config,
		Condition: cond,
	}
}

func toPolDomains(rows []policyRow) []domain.Policy {
	out := make([]domain.Policy, len(rows))
	for i, r := range rows {
		out[i] = toPolDomain(r)
	}
	return out
}

func nullString(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

// DB exposes the underlying DB for direct queries (e.g. templates).
func (r *ManagementRepo) DB() *DB { return r.db }
