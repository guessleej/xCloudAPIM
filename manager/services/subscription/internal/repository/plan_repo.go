package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/jmoiron/sqlx"
	"github.com/xcloudapim/subscription-service/internal/domain"
)

type PlanRepo struct {
	db *sqlx.DB
}

func NewPlanRepo(db *sqlx.DB) *PlanRepo {
	return &PlanRepo{db: db}
}

type planRow struct {
	ID           string         `db:"id"`
	Name         string         `db:"name"`
	DisplayName  string         `db:"display_name"`
	Description  sql.NullString `db:"description"`
	RPMLimit     int64          `db:"rpm_limit"`
	RPHLimit     sql.NullInt64  `db:"rph_limit"`
	RPDLimit     int64          `db:"rpd_limit"`
	RPMMonth     sql.NullInt64  `db:"rpm_limit_month"`
	BurstMult    float64        `db:"burst_multiplier"`
	FeaturesJSON []byte         `db:"features"`
	MaxAPIKeys   int            `db:"max_api_keys"`
	MaxApps      int            `db:"max_apps"`
	PriceCents   int            `db:"price_cents"`
	Currency     string         `db:"currency"`
	IsPublic     bool           `db:"is_public"`
	IsActive     bool           `db:"is_active"`
	SortOrder    int            `db:"sort_order"`
}

func (r *PlanRepo) List(ctx context.Context, activeOnly bool) ([]*domain.Plan, error) {
	q := `SELECT id, name, display_name, description, rpm_limit, rph_limit, rpd_limit,
	             rpm_limit_month, burst_multiplier, features, max_api_keys, max_apps,
	             price_cents, currency, is_public, is_active, sort_order
	      FROM   plans`
	if activeOnly {
		q += " WHERE is_active = TRUE AND is_public = TRUE"
	}
	q += " ORDER BY sort_order"

	var rows []planRow
	if err := r.db.SelectContext(ctx, &rows, q); err != nil {
		return nil, err
	}
	return mapPlans(rows)
}

func (r *PlanRepo) GetByID(ctx context.Context, id string) (*domain.Plan, error) {
	const q = `SELECT id, name, display_name, description, rpm_limit, rph_limit, rpd_limit,
	                  rpm_limit_month, burst_multiplier, features, max_api_keys, max_apps,
	                  price_cents, currency, is_public, is_active, sort_order
	           FROM   plans WHERE id = $1`
	var row planRow
	if err := r.db.GetContext(ctx, &row, q, id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, domain.ErrPlanNotFound
		}
		return nil, err
	}
	plans, err := mapPlans([]planRow{row})
	if err != nil || len(plans) == 0 {
		return nil, err
	}
	return plans[0], nil
}

func (r *PlanRepo) GetByName(ctx context.Context, name string) (*domain.Plan, error) {
	const q = `SELECT id, name, display_name, description, rpm_limit, rph_limit, rpd_limit,
	                  rpm_limit_month, burst_multiplier, features, max_api_keys, max_apps,
	                  price_cents, currency, is_public, is_active, sort_order
	           FROM   plans WHERE name = $1`
	var row planRow
	if err := r.db.GetContext(ctx, &row, q, name); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, domain.ErrPlanNotFound
		}
		return nil, err
	}
	plans, err := mapPlans([]planRow{row})
	if err != nil || len(plans) == 0 {
		return nil, err
	}
	return plans[0], nil
}

func mapPlans(rows []planRow) ([]*domain.Plan, error) {
	out := make([]*domain.Plan, 0, len(rows))
	for _, r := range rows {
		p := &domain.Plan{
			ID:          r.ID,
			Name:        r.Name,
			DisplayName: r.DisplayName,
			RPMLimit:    r.RPMLimit,
			RPDLimit:    r.RPDLimit,
			BurstMult:   r.BurstMult,
			MaxAPIKeys:  r.MaxAPIKeys,
			MaxApps:     r.MaxApps,
			PriceCents:  r.PriceCents,
			Currency:    r.Currency,
			IsPublic:    r.IsPublic,
			IsActive:    r.IsActive,
			SortOrder:   r.SortOrder,
		}
		if r.Description.Valid {
			p.Description = r.Description.String
		}
		if r.RPHLimit.Valid {
			v := r.RPHLimit.Int64
			p.RPHLimit = &v
		}
		if r.RPMMonth.Valid {
			v := r.RPMMonth.Int64
			p.RPMMonth = &v
		}
		if len(r.FeaturesJSON) > 0 {
			json.Unmarshal(r.FeaturesJSON, &p.Features) //nolint:errcheck
		}
		out = append(out, p)
	}
	return out, nil
}
