package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/xcloudapim/subscription-service/internal/domain"
)

type SubscriptionRepo struct {
	db *sqlx.DB
}

func NewSubscriptionRepo(db *sqlx.DB) *SubscriptionRepo {
	return &SubscriptionRepo{db: db}
}

func (r *SubscriptionRepo) Create(ctx context.Context, sub *domain.Subscription) error {
	const q = `
		INSERT INTO subscriptions
		    (id, organization_id, api_id, plan_id, subscriber_id, status, start_date, notes, created_at, updated_at)
		VALUES
		    (:id, :organization_id, :api_id, :plan_id, :subscriber_id, :status, :start_date, :notes, :created_at, :updated_at)`

	now := time.Now()
	sub.CreatedAt = now
	sub.UpdatedAt = now
	if sub.StartDate.IsZero() {
		sub.StartDate = now
	}

	_, err := r.db.NamedExecContext(ctx, q, sub)
	if err != nil && strings.Contains(err.Error(), "unique") {
		return domain.ErrSubscriptionExists
	}
	return err
}

func (r *SubscriptionRepo) GetByID(ctx context.Context, id string) (*domain.Subscription, error) {
	const q = `
		SELECT s.id, s.organization_id, s.api_id, s.plan_id, s.subscriber_id,
		       s.status, s.start_date, s.end_date, s.approved_by, s.approved_at,
		       s.rejected_reason, s.notes, s.created_at, s.updated_at
		FROM   subscriptions s
		WHERE  s.id = $1`

	var sub domain.Subscription
	if err := r.db.GetContext(ctx, &sub, q, id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	return &sub, nil
}

func (r *SubscriptionRepo) GetByOrgAndAPI(ctx context.Context, orgID, apiID string) (*domain.Subscription, error) {
	const q = `
		SELECT id, organization_id, api_id, plan_id, subscriber_id, status,
		       start_date, end_date, approved_by, approved_at, rejected_reason,
		       notes, created_at, updated_at
		FROM   subscriptions
		WHERE  organization_id = $1 AND api_id = $2`

	var sub domain.Subscription
	if err := r.db.GetContext(ctx, &sub, q, orgID, apiID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	return &sub, nil
}

type ListSubFilter struct {
	OrgID  string
	Status string
	APIID  string
	Page   int
	Size   int
}

func (r *SubscriptionRepo) List(ctx context.Context, f ListSubFilter) ([]*domain.Subscription, int, error) {
	var where []string
	var args []interface{}
	idx := 1

	if f.OrgID != "" {
		where = append(where, fmt.Sprintf("organization_id = $%d", idx))
		args = append(args, f.OrgID)
		idx++
	}
	if f.Status != "" {
		where = append(where, fmt.Sprintf("status = $%d", idx))
		args = append(args, f.Status)
		idx++
	}
	if f.APIID != "" {
		where = append(where, fmt.Sprintf("api_id = $%d", idx))
		args = append(args, f.APIID)
		idx++
	}

	baseQ := "FROM subscriptions"
	if len(where) > 0 {
		baseQ += " WHERE " + strings.Join(where, " AND ")
	}

	var total int
	if err := r.db.GetContext(ctx, &total, "SELECT COUNT(*) "+baseQ, args...); err != nil {
		return nil, 0, err
	}

	const maxPageSize = 100
	if f.Size <= 0 {
		f.Size = 20
	} else if f.Size > maxPageSize {
		f.Size = maxPageSize
	}
	if f.Page <= 0 {
		f.Page = 1
	}
	offset := (f.Page - 1) * f.Size

	selectQ := fmt.Sprintf(`SELECT id, organization_id, api_id, plan_id, subscriber_id,
		status, start_date, end_date, approved_by, approved_at, rejected_reason,
		notes, created_at, updated_at %s ORDER BY created_at DESC LIMIT $%d OFFSET $%d`,
		baseQ, idx, idx+1)
	args = append(args, f.Size, offset)

	var subs []*domain.Subscription
	if err := r.db.SelectContext(ctx, &subs, selectQ, args...); err != nil {
		return nil, 0, err
	}
	return subs, total, nil
}

func (r *SubscriptionRepo) UpdateStatus(ctx context.Context, id string, status domain.SubscriptionStatus, approverID *string) error {
	var q string
	var args []interface{}

	if approverID != nil && status == domain.SubStatusActive {
		q = `UPDATE subscriptions SET status=$1, approved_by=$2, approved_at=NOW(), updated_at=NOW() WHERE id=$3`
		args = []interface{}{status, *approverID, id}
	} else {
		q = `UPDATE subscriptions SET status=$1, updated_at=NOW() WHERE id=$2`
		args = []interface{}{status, id}
	}

	res, err := r.db.ExecContext(ctx, q, args...)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (r *SubscriptionRepo) ChangePlan(ctx context.Context, id, planID string) error {
	const q = `UPDATE subscriptions SET plan_id=$1, updated_at=NOW() WHERE id=$2`
	res, err := r.db.ExecContext(ctx, q, planID, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// GetActiveByAPIKey 透過 subscription_id 取得 active 訂閱（API Key 驗證路徑）
func (r *SubscriptionRepo) GetActiveByID(ctx context.Context, id string) (*domain.Subscription, error) {
	const q = `
		SELECT id, organization_id, api_id, plan_id, subscriber_id, status,
		       start_date, end_date, notes, created_at, updated_at
		FROM   subscriptions
		WHERE  id = $1 AND status = 'active'`

	var sub domain.Subscription
	if err := r.db.GetContext(ctx, &sub, q, id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, domain.ErrSubscriptionNotActive
		}
		return nil, err
	}
	return &sub, nil
}
