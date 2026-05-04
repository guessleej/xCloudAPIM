package repository

import (
	"context"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/xcloudapim/subscription-service/internal/domain"
)

type QuotaRepo struct {
	db *sqlx.DB
}

func NewQuotaRepo(db *sqlx.DB) *QuotaRepo {
	return &QuotaRepo{db: db}
}

// UpsertDaily 原子性更新或建立當日用量（PostgreSQL ON CONFLICT）
func (r *QuotaRepo) UpsertDaily(ctx context.Context, subID, apiID string, delta int64, isErr bool) error {
	errDelta := int64(0)
	if isErr {
		errDelta = delta
	}
	const q = `
		INSERT INTO quota_usage_daily
		    (id, subscription_id, api_id, usage_date, request_count, success_count, error_count, created_at, updated_at)
		VALUES
		    (uuid_generate_v4(), $1, $2, CURRENT_DATE, $3, $4, $5, NOW(), NOW())
		ON CONFLICT (subscription_id, api_id, usage_date)
		DO UPDATE SET
		    request_count = quota_usage_daily.request_count + EXCLUDED.request_count,
		    success_count = quota_usage_daily.success_count + EXCLUDED.success_count,
		    error_count   = quota_usage_daily.error_count   + EXCLUDED.error_count,
		    updated_at    = NOW()`

	successDelta := delta - errDelta
	_, err := r.db.ExecContext(ctx, q, subID, apiID, delta, successDelta, errDelta)
	return err
}

// UpsertMonthly 更新當月彙總用量
func (r *QuotaRepo) UpsertMonthly(ctx context.Context, subID, apiID string, delta, overQuota int64, isErr bool) error {
	errDelta := int64(0)
	if isErr {
		errDelta = delta
	}
	yearMonth := time.Now().Format("2006-01")
	const q = `
		INSERT INTO quota_usage_monthly
		    (id, subscription_id, api_id, year_month, request_count, error_count, over_quota_count, updated_at)
		VALUES
		    (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, NOW())
		ON CONFLICT (subscription_id, api_id, year_month)
		DO UPDATE SET
		    request_count    = quota_usage_monthly.request_count    + EXCLUDED.request_count,
		    error_count      = quota_usage_monthly.error_count      + EXCLUDED.error_count,
		    over_quota_count = quota_usage_monthly.over_quota_count + EXCLUDED.over_quota_count,
		    updated_at       = NOW()`

	_, err := r.db.ExecContext(ctx, q, subID, apiID, yearMonth, delta, errDelta, overQuota)
	return err
}

// GetDailyUsage 取得指定日期範圍的每日用量
func (r *QuotaRepo) GetDailyUsage(ctx context.Context, subID, apiID, from, to string) ([]*domain.QuotaUsageDaily, error) {
	const q = `
		SELECT id, subscription_id, api_id, usage_date, request_count, success_count,
		       error_count, total_bytes_in, total_bytes_out, avg_latency_ms,
		       p95_latency_ms, p99_latency_ms, created_at, updated_at
		FROM   quota_usage_daily
		WHERE  subscription_id=$1 AND api_id=$2
		  AND  usage_date BETWEEN $3::date AND $4::date
		ORDER  BY usage_date`

	var rows []*domain.QuotaUsageDaily
	err := r.db.SelectContext(ctx, &rows, q, subID, apiID, from, to)
	return rows, err
}

// GetMonthlyUsage 取得月彙總用量
func (r *QuotaRepo) GetMonthlyUsage(ctx context.Context, subID, apiID string, limit int) ([]*domain.QuotaUsageMonthly, error) {
	if limit <= 0 {
		limit = 12
	}
	const q = `
		SELECT id, subscription_id, api_id, year_month, request_count, error_count,
		       over_quota_count, updated_at
		FROM   quota_usage_monthly
		WHERE  subscription_id=$1 AND api_id=$2
		ORDER  BY year_month DESC
		LIMIT  $3`

	var rows []*domain.QuotaUsageMonthly
	err := r.db.SelectContext(ctx, &rows, q, subID, apiID, limit)
	return rows, err
}

// GetTodayCount 取得今日已使用量（從 PostgreSQL，用於初始化 Redis 計數）
func (r *QuotaRepo) GetTodayCount(ctx context.Context, subID, apiID string) (int64, error) {
	const q = `
		SELECT COALESCE(request_count, 0)
		FROM   quota_usage_daily
		WHERE  subscription_id=$1 AND api_id=$2 AND usage_date=CURRENT_DATE`

	var count int64
	err := r.db.GetContext(ctx, &count, q, subID, apiID)
	if err != nil {
		return 0, nil // 無記錄視為 0
	}
	return count, nil
}
