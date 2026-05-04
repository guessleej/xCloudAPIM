package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/xcloudapim/registry-service/internal/domain"
)

type VersionRepository struct{ db *DB }

func NewVersionRepository(db *DB) *VersionRepository { return &VersionRepository{db: db} }

// ─── Create ───────────────────────────────────────────────────

func (r *VersionRepository) Create(ctx context.Context, v *domain.APIVersion) error {
	const q = `
		INSERT INTO api_versions (
			id, api_id, version, status, spec_format, spec_content,
			spec_version, backend_protocol, upstream_url, strip_prefix,
			base_path, timeout_ms, retry_count, retry_delay_ms,
			changelog, created_by
		) VALUES (
			$1,$2,$3,$4::api_version_status,$5,$6,
			$7,$8::backend_protocol,$9,$10,
			$11,$12,$13,$14,
			$15,$16
		)`

	_, err := r.db.ExecContext(ctx, q,
		v.ID, v.APIID, v.Version,
		string(v.Status),
		v.SpecFormat, nullStr(v.SpecContent),
		v.SpecVersion, v.BackendProtocol, v.UpstreamURL, nullStr(v.StripPrefix),
		v.BasePath, v.TimeoutMS, v.RetryCount, v.RetryDelayMS,
		nullStr(v.Changelog), v.CreatedBy,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return domain.ErrVersionConflict
		}
		return fmt.Errorf("create version: %w", err)
	}
	return nil
}

// ─── Read ─────────────────────────────────────────────────────

func (r *VersionRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.APIVersion, error) {
	const q = `
		SELECT id, api_id, version, status, spec_format,
		       spec_content, spec_version, backend_protocol, upstream_url,
		       COALESCE(strip_prefix,'') AS strip_prefix,
		       base_path, timeout_ms, retry_count, retry_delay_ms,
		       COALESCE(changelog,'') AS changelog,
		       published_at, deprecated_at, sunset_date,
		       created_by, created_at, updated_at
		FROM api_versions WHERE id = $1`
	return r.scanVersion(ctx, q, id)
}

func (r *VersionRepository) GetByAPIAndVersion(ctx context.Context, apiID uuid.UUID, version string) (*domain.APIVersion, error) {
	const q = `
		SELECT id, api_id, version, status, spec_format,
		       spec_content, spec_version, backend_protocol, upstream_url,
		       COALESCE(strip_prefix,'') AS strip_prefix,
		       base_path, timeout_ms, retry_count, retry_delay_ms,
		       COALESCE(changelog,'') AS changelog,
		       published_at, deprecated_at, sunset_date,
		       created_by, created_at, updated_at
		FROM api_versions WHERE api_id = $1 AND version = $2`
	return r.scanVersion(ctx, q, apiID, version)
}

func (r *VersionRepository) GetLatestActive(ctx context.Context, apiID uuid.UUID) (*domain.APIVersion, error) {
	const q = `
		SELECT id, api_id, version, status, spec_format,
		       spec_content, spec_version, backend_protocol, upstream_url,
		       COALESCE(strip_prefix,'') AS strip_prefix,
		       base_path, timeout_ms, retry_count, retry_delay_ms,
		       COALESCE(changelog,'') AS changelog,
		       published_at, deprecated_at, sunset_date,
		       created_by, created_at, updated_at
		FROM api_versions
		WHERE api_id = $1 AND status = 'active'
		ORDER BY published_at DESC
		LIMIT 1`
	return r.scanVersion(ctx, q, apiID)
}

func (r *VersionRepository) ListByAPI(ctx context.Context, apiID uuid.UUID) ([]*domain.APIVersion, error) {
	const q = `
		SELECT id, api_id, version, status, spec_format,
		       '' AS spec_content,  -- 清單不回傳完整 spec
		       spec_version, backend_protocol, upstream_url,
		       COALESCE(strip_prefix,'') AS strip_prefix,
		       base_path, timeout_ms, retry_count, retry_delay_ms,
		       COALESCE(changelog,'') AS changelog,
		       published_at, deprecated_at, sunset_date,
		       created_by, created_at, updated_at
		FROM api_versions
		WHERE api_id = $1
		ORDER BY created_at DESC`

	rows, err := r.db.QueryxContext(ctx, q, apiID)
	if err != nil {
		return nil, fmt.Errorf("list versions: %w", err)
	}
	defer rows.Close()

	var versions []*domain.APIVersion
	for rows.Next() {
		v, err := scanVersionRow(rows)
		if err != nil {
			return nil, err
		}
		versions = append(versions, v)
	}
	return versions, nil
}

// ─── Update ───────────────────────────────────────────────────

func (r *VersionRepository) Update(ctx context.Context, id uuid.UUID, req *domain.UpdateVersionRequest) (*domain.APIVersion, error) {
	sets := []string{"updated_at = NOW()"}
	args := []interface{}{}
	idx := 1

	if req.BackendProtocol != nil {
		sets = append(sets, fmt.Sprintf("backend_protocol = $%d::backend_protocol", idx))
		args = append(args, *req.BackendProtocol); idx++
	}
	if req.UpstreamURL != nil {
		sets = append(sets, fmt.Sprintf("upstream_url = $%d", idx))
		args = append(args, *req.UpstreamURL); idx++
	}
	if req.StripPrefix != nil {
		sets = append(sets, fmt.Sprintf("strip_prefix = $%d", idx))
		args = append(args, *req.StripPrefix); idx++
	}
	if req.BasePath != nil {
		sets = append(sets, fmt.Sprintf("base_path = $%d", idx))
		args = append(args, *req.BasePath); idx++
	}
	if req.TimeoutMS != nil {
		sets = append(sets, fmt.Sprintf("timeout_ms = $%d", idx))
		args = append(args, *req.TimeoutMS); idx++
	}
	if req.RetryCount != nil {
		sets = append(sets, fmt.Sprintf("retry_count = $%d", idx))
		args = append(args, *req.RetryCount); idx++
	}
	if req.Changelog != nil {
		sets = append(sets, fmt.Sprintf("changelog = $%d", idx))
		args = append(args, *req.Changelog); idx++
	}

	args = append(args, id)
	q := fmt.Sprintf(
		`UPDATE api_versions SET %s WHERE id = $%d`,
		strings.Join(sets, ", "), idx,
	)
	if _, err := r.db.ExecContext(ctx, q, args...); err != nil {
		return nil, fmt.Errorf("update version: %w", err)
	}
	return r.GetByID(ctx, id)
}

// UpdateSpec 上傳/更新 OpenAPI Spec
func (r *VersionRepository) UpdateSpec(ctx context.Context, id uuid.UUID, format, content string) error {
	const q = `
		UPDATE api_versions
		SET spec_format = $1, spec_content = $2, updated_at = NOW()
		WHERE id = $3`
	res, err := r.db.ExecContext(ctx, q, format, content, id)
	if err != nil {
		return fmt.Errorf("update spec: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return domain.ErrVersionNotFound
	}
	return nil
}

// ─── Status Transitions ───────────────────────────────────────

func (r *VersionRepository) Publish(ctx context.Context, id uuid.UUID) error {
	const q = `
		UPDATE api_versions
		SET status = 'active'::api_version_status,
		    published_at = NOW(),
		    updated_at   = NOW()
		WHERE id = $1 AND status = 'draft'`

	res, err := r.db.ExecContext(ctx, q, id)
	if err != nil {
		return fmt.Errorf("publish version: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return domain.ErrVersionNotDraft
	}
	return nil
}

func (r *VersionRepository) Deprecate(ctx context.Context, id uuid.UUID, sunsetDate *time.Time) error {
	const q = `
		UPDATE api_versions
		SET status        = 'deprecated'::api_version_status,
		    deprecated_at = NOW(),
		    sunset_date   = $2,
		    updated_at    = NOW()
		WHERE id = $1 AND status = 'active'`

	if _, err := r.db.ExecContext(ctx, q, id, sunsetDate); err != nil {
		return fmt.Errorf("deprecate version: %w", err)
	}
	return nil
}

func (r *VersionRepository) Retire(ctx context.Context, id uuid.UUID) error {
	const q = `
		UPDATE api_versions
		SET status = 'retired'::api_version_status, updated_at = NOW()
		WHERE id = $1`
	_, err := r.db.ExecContext(ctx, q, id)
	return err
}

// ─── internal scan helpers ────────────────────────────────────

func (r *VersionRepository) scanVersion(ctx context.Context, q string, args ...interface{}) (*domain.APIVersion, error) {
	row := r.db.QueryRowxContext(ctx, q, args...)
	v, err := scanVersionRow(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, domain.ErrVersionNotFound
		}
		return nil, fmt.Errorf("scan version: %w", err)
	}
	return v, nil
}

func scanVersionRow(row interface{ Scan(...interface{}) error }) (*domain.APIVersion, error) {
	var v domain.APIVersion
	var specContent sql.NullString
	err := row.Scan(
		&v.ID, &v.APIID, &v.Version, &v.Status,
		&v.SpecFormat, &specContent, &v.SpecVersion,
		&v.BackendProtocol, &v.UpstreamURL, &v.StripPrefix,
		&v.BasePath, &v.TimeoutMS, &v.RetryCount, &v.RetryDelayMS,
		&v.Changelog, &v.PublishedAt, &v.DeprecatedAt, &v.SunsetDate,
		&v.CreatedBy, &v.CreatedAt, &v.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	if specContent.Valid {
		v.SpecContent = specContent.String
	}
	return &v, nil
}
