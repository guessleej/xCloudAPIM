package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/xcloudapim/registry-service/internal/domain"
)

type APIRepository struct{ db *DB }

func NewAPIRepository(db *DB) *APIRepository { return &APIRepository{db: db} }

// ─── Create ───────────────────────────────────────────────────

func (r *APIRepository) Create(ctx context.Context, api *domain.API) error {
	const q = `
		INSERT INTO apis (
			id, organization_id, name, slug, description, category,
			tags, status, is_public, owner_id, thumbnail_url,
			documentation_url, metadata
		) VALUES (
			$1,$2,$3,$4,$5,$6,
			$7,$8::api_status,$9,$10,$11,
			$12,$13
		)`

	tags := pq.Array(api.Tags)
	meta := "{}"
	if api.Metadata != nil {
		if b, err := marshalJSON(api.Metadata); err == nil {
			meta = string(b)
		}
	}
	_, err := r.db.ExecContext(ctx, q,
		api.ID, api.OrganizationID, api.Name, api.Slug, api.Description, api.Category,
		tags, string(api.Status), api.IsPublic, api.OwnerID, api.ThumbnailURL,
		api.DocumentationURL, meta,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return domain.ErrSlugConflict
		}
		return fmt.Errorf("create api: %w", err)
	}
	return nil
}

// ─── Read ─────────────────────────────────────────────────────

func (r *APIRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.API, error) {
	const q = `
		SELECT
			a.id, a.organization_id, a.name, a.slug, a.description,
			a.category, a.tags, a.status, a.is_public, a.owner_id,
			a.thumbnail_url, a.documentation_url, a.metadata,
			a.created_at, a.updated_at,
			COUNT(v.id) FILTER (WHERE v.status != 'retired') AS version_count
		FROM apis a
		LEFT JOIN api_versions v ON v.api_id = a.id
		WHERE a.id = $1 AND a.deleted_at IS NULL
		GROUP BY a.id`

	return r.scanAPI(ctx, q, id)
}

func (r *APIRepository) GetBySlug(ctx context.Context, orgID uuid.UUID, slug string) (*domain.API, error) {
	const q = `
		SELECT
			a.id, a.organization_id, a.name, a.slug, a.description,
			a.category, a.tags, a.status, a.is_public, a.owner_id,
			a.thumbnail_url, a.documentation_url, a.metadata,
			a.created_at, a.updated_at,
			COUNT(v.id) FILTER (WHERE v.status != 'retired') AS version_count
		FROM apis a
		LEFT JOIN api_versions v ON v.api_id = a.id
		WHERE a.organization_id = $1 AND a.slug = $2 AND a.deleted_at IS NULL
		GROUP BY a.id`

	return r.scanAPI(ctx, q, orgID, slug)
}

func (r *APIRepository) List(ctx context.Context, orgID uuid.UUID, p *domain.APIListParams) (*domain.PaginatedAPIs, error) {
	where := []string{"a.organization_id = $1", "a.deleted_at IS NULL"}
	args := []interface{}{orgID}
	idx := 2

	if p.Status != "" {
		where = append(where, fmt.Sprintf("a.status = $%d::api_status", idx))
		args = append(args, string(p.Status))
		idx++
	}
	if p.Category != "" {
		where = append(where, fmt.Sprintf("a.category = $%d", idx))
		args = append(args, p.Category)
		idx++
	}
	if p.Tag != "" {
		where = append(where, fmt.Sprintf("$%d = ANY(a.tags)", idx))
		args = append(args, p.Tag)
		idx++
	}
	if p.Search != "" {
		where = append(where, fmt.Sprintf(
			"(a.name ILIKE $%d OR a.description ILIKE $%d OR a.slug ILIKE $%d)",
			idx, idx, idx))
		args = append(args, "%"+p.Search+"%")
		idx++
	}

	whereClause := "WHERE " + strings.Join(where, " AND ")

	// Count
	countQ := fmt.Sprintf("SELECT COUNT(*) FROM apis a %s", whereClause)
	var total int64
	if err := r.db.GetContext(ctx, &total, countQ, args...); err != nil {
		return nil, fmt.Errorf("count apis: %w", err)
	}

	// Sort whitelist
	allowedSort := map[string]string{
		"created_at": "a.created_at",
		"updated_at": "a.updated_at",
		"name":       "a.name",
		"status":     "a.status",
	}
	sortCol, ok := allowedSort[p.SortBy]
	if !ok {
		sortCol = "a.created_at"
	}
	sortDir := "DESC"
	if strings.ToUpper(p.SortOrder) == "ASC" {
		sortDir = "ASC"
	}

	offset := (p.Page - 1) * p.PageSize
	listQ := fmt.Sprintf(`
		SELECT
			a.id, a.organization_id, a.name, a.slug, a.description,
			a.category, a.tags, a.status, a.is_public, a.owner_id,
			a.thumbnail_url, a.documentation_url, a.metadata,
			a.created_at, a.updated_at,
			COUNT(v.id) FILTER (WHERE v.status != 'retired') AS version_count
		FROM apis a
		LEFT JOIN api_versions v ON v.api_id = a.id
		%s
		GROUP BY a.id
		ORDER BY %s %s
		LIMIT $%d OFFSET $%d`,
		whereClause, sortCol, sortDir, idx, idx+1,
	)
	args = append(args, p.PageSize, offset)

	rows, err := r.db.QueryxContext(ctx, listQ, args...)
	if err != nil {
		return nil, fmt.Errorf("list apis: %w", err)
	}
	defer rows.Close()

	var apis []*domain.API
	for rows.Next() {
		a, err := scanAPIRow(rows)
		if err != nil {
			return nil, err
		}
		apis = append(apis, a)
	}

	totalPages := int((total + int64(p.PageSize) - 1) / int64(p.PageSize))
	return &domain.PaginatedAPIs{
		Items:      apis,
		Total:      total,
		Page:       p.Page,
		PageSize:   p.PageSize,
		TotalPages: totalPages,
	}, nil
}

// ─── Update ───────────────────────────────────────────────────

func (r *APIRepository) Update(ctx context.Context, id uuid.UUID, req *domain.UpdateAPIRequest) (*domain.API, error) {
	sets := []string{"updated_at = NOW()"}
	args := []interface{}{}
	idx := 1

	if req.Name != nil {
		sets = append(sets, fmt.Sprintf("name = $%d", idx))
		args = append(args, *req.Name)
		idx++
	}
	if req.Description != nil {
		sets = append(sets, fmt.Sprintf("description = $%d", idx))
		args = append(args, *req.Description)
		idx++
	}
	if req.Category != nil {
		sets = append(sets, fmt.Sprintf("category = $%d", idx))
		args = append(args, *req.Category)
		idx++
	}
	if req.Tags != nil {
		sets = append(sets, fmt.Sprintf("tags = $%d", idx))
		args = append(args, pq.Array(req.Tags))
		idx++
	}
	if req.IsPublic != nil {
		sets = append(sets, fmt.Sprintf("is_public = $%d", idx))
		args = append(args, *req.IsPublic)
		idx++
	}
	if req.ThumbnailURL != nil {
		sets = append(sets, fmt.Sprintf("thumbnail_url = $%d", idx))
		args = append(args, *req.ThumbnailURL)
		idx++
	}
	if req.DocumentationURL != nil {
		sets = append(sets, fmt.Sprintf("documentation_url = $%d", idx))
		args = append(args, *req.DocumentationURL)
		idx++
	}
	if req.Status != nil {
		sets = append(sets, fmt.Sprintf("status = $%d::api_status", idx))
		args = append(args, string(*req.Status))
		idx++
	}

	args = append(args, id)
	q := fmt.Sprintf(`UPDATE apis SET %s WHERE id = $%d AND deleted_at IS NULL`,
		strings.Join(sets, ", "), idx)

	res, err := r.db.ExecContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("update api: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, domain.ErrAPINotFound
	}
	return r.GetByID(ctx, id)
}

// ─── Delete（soft delete） ────────────────────────────────────

func (r *APIRepository) Delete(ctx context.Context, id uuid.UUID) error {
	// 確認不是 published 狀態
	const checkQ = `SELECT status FROM apis WHERE id = $1 AND deleted_at IS NULL`
	var status string
	if err := r.db.GetContext(ctx, &status, checkQ, id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.ErrAPINotFound
		}
		return err
	}
	if status == string(domain.APIStatusPublished) {
		return domain.ErrCannotDeletePublished
	}

	const q = `UPDATE apis SET deleted_at = NOW() WHERE id = $1`
	_, err := r.db.ExecContext(ctx, q, id)
	return err
}

// ─── Gateway Routes ───────────────────────────────────────────

func (r *APIRepository) ListActiveRoutes(ctx context.Context) ([]*domain.GatewayRoute, error) {
	const q = `
		SELECT
			gr.id, gr.api_id, gr.api_version_id,
			a.name  AS api_name,
			av.version AS api_version,
			COALESCE(gr.host_match,'') AS host_match,
			gr.path_prefix,
			COALESCE(gr.methods, ARRAY[]::endpoint_method[]) AS methods,
			gr.upstream_url,
			COALESCE(gr.strip_prefix,'') AS strip_prefix,
			gr.policy_chain_id,
			gr.active, gr.priority, gr.updated_at
		FROM gateway_routes gr
		JOIN apis a          ON a.id  = gr.api_id
		JOIN api_versions av ON av.id = gr.api_version_id
		WHERE gr.active = TRUE
		ORDER BY gr.priority ASC, gr.updated_at DESC`

	rows, err := r.db.QueryxContext(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("list active routes: %w", err)
	}
	defer rows.Close()

	var routes []*domain.GatewayRoute
	for rows.Next() {
		var route domain.GatewayRoute
		var methods pq.StringArray
		if err := rows.Scan(
			&route.ID, &route.APIID, &route.APIVersionID,
			&route.APIName, &route.APIVersion,
			&route.HostMatch, &route.PathPrefix,
			&methods,
			&route.UpstreamURL, &route.StripPrefix,
			&route.PolicyChainID, &route.Active, &route.Priority, &route.UpdatedAt,
		); err != nil {
			return nil, err
		}
		route.Methods = []string(methods)
		routes = append(routes, &route)
	}
	return routes, nil
}

func (r *APIRepository) UpsertGatewayRoute(ctx context.Context, route *domain.GatewayRoute) error {
	const q = `
		INSERT INTO gateway_routes (
			id, api_id, api_version_id, host_match, path_prefix,
			upstream_url, strip_prefix, policy_chain_id, active, priority
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		ON CONFLICT (api_id, api_version_id)
		DO UPDATE SET
			host_match       = EXCLUDED.host_match,
			path_prefix      = EXCLUDED.path_prefix,
			upstream_url     = EXCLUDED.upstream_url,
			strip_prefix     = EXCLUDED.strip_prefix,
			policy_chain_id  = EXCLUDED.policy_chain_id,
			active           = EXCLUDED.active,
			priority         = EXCLUDED.priority,
			updated_at       = NOW()`

	_, err := r.db.ExecContext(ctx, q,
		route.ID, route.APIID, route.APIVersionID,
		nullStr(route.HostMatch), route.PathPrefix,
		route.UpstreamURL, nullStr(route.StripPrefix),
		route.PolicyChainID, route.Active, route.Priority,
	)
	return err
}

// ─── internal helpers ─────────────────────────────────────────

type scannable interface {
	Scan(dest ...interface{}) error
}

func (r *APIRepository) scanAPI(ctx context.Context, q string, args ...interface{}) (*domain.API, error) {
	row := r.db.QueryRowxContext(ctx, q, args...)
	api, err := scanAPIRow(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, domain.ErrAPINotFound
		}
		return nil, fmt.Errorf("scan api: %w", err)
	}
	return api, nil
}

func scanAPIRow(row interface{ Scan(...interface{}) error }) (*domain.API, error) {
	var a domain.API
	var tags    pq.StringArray
	var metaStr string
	err := row.Scan(
		&a.ID, &a.OrganizationID, &a.Name, &a.Slug, &a.Description,
		&a.Category, &tags, &a.Status, &a.IsPublic, &a.OwnerID,
		&a.ThumbnailURL, &a.DocumentationURL, &metaStr,
		&a.CreatedAt, &a.UpdatedAt, &a.VersionCount,
	)
	if err != nil {
		return nil, err
	}
	a.Tags = []string(tags)
	return &a, nil
}

func isUniqueViolation(err error) bool {
	var pgErr *pq.Error
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func nullStr(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

func marshalJSON(v interface{}) ([]byte, error) {
	return json.Marshal(v)
}

// UpdatedAt 用於記錄最後同步時間（供 Gateway 增量更新）
func (r *APIRepository) GetRoutesUpdatedAfter(ctx context.Context, since time.Time) ([]*domain.GatewayRoute, error) {
	const q = `
		SELECT
			gr.id, gr.api_id, gr.api_version_id,
			a.name  AS api_name,
			av.version AS api_version,
			COALESCE(gr.host_match,'') AS host_match,
			gr.path_prefix,
			COALESCE(gr.methods, ARRAY[]::endpoint_method[]) AS methods,
			gr.upstream_url,
			COALESCE(gr.strip_prefix,'') AS strip_prefix,
			gr.policy_chain_id,
			gr.active, gr.priority, gr.updated_at
		FROM gateway_routes gr
		JOIN apis a          ON a.id  = gr.api_id
		JOIN api_versions av ON av.id = gr.api_version_id
		WHERE gr.updated_at > $1
		ORDER BY gr.updated_at DESC`

	rows, err := r.db.QueryxContext(ctx, q, since)
	if err != nil {
		return nil, fmt.Errorf("get routes delta: %w", err)
	}
	defer rows.Close()

	var routes []*domain.GatewayRoute
	for rows.Next() {
		var route domain.GatewayRoute
		var methods pq.StringArray
		if err := rows.Scan(
			&route.ID, &route.APIID, &route.APIVersionID,
			&route.APIName, &route.APIVersion,
			&route.HostMatch, &route.PathPrefix, &methods,
			&route.UpstreamURL, &route.StripPrefix,
			&route.PolicyChainID, &route.Active, &route.Priority, &route.UpdatedAt,
		); err != nil {
			return nil, err
		}
		route.Methods = []string(methods)
		routes = append(routes, &route)
	}
	return routes, nil
}
