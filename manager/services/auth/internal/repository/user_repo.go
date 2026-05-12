package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/xcloudapim/auth-service/internal/domain"
	"golang.org/x/crypto/bcrypt"
)

type UserRepository struct {
	db *DB
}

func NewUserRepository(db *DB) *UserRepository {
	return &UserRepository{db: db}
}

func (r *UserRepository) GetByEmail(ctx context.Context, email string) (*domain.User, error) {
	const q = `
		SELECT
			u.id, u.email, u.display_name, u.password_hash, u.status,
			om.organization_id,
			COALESCE(o.name, '') AS org_name,
			COALESCE(om.role::text, 'developer') AS role
		FROM users u
		LEFT JOIN organization_members om ON om.user_id = u.id
		LEFT JOIN organizations o ON o.id = om.organization_id AND o.deleted_at IS NULL
		WHERE u.email = $1 AND u.deleted_at IS NULL
		ORDER BY om.joined_at ASC NULLS LAST
		LIMIT 1`

	type row struct {
		ID             uuid.UUID      `db:"id"`
		Email          string         `db:"email"`
		DisplayName    string         `db:"display_name"`
		PasswordHash   sql.NullString `db:"password_hash"`
		Status         string         `db:"status"`
		OrganizationID uuid.NullUUID  `db:"organization_id"`
		OrgName        string         `db:"org_name"`
		Role           string         `db:"role"`
	}

	var r0 row
	if err := r.db.GetContext(ctx, &r0, q, email); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}

	return &domain.User{
		ID:           r0.ID,
		Email:        r0.Email,
		DisplayName:  r0.DisplayName,
		PasswordHash: r0.PasswordHash.String,
		Active:       r0.Status == "active",
		OrgID:        nullableUUID(r0.OrganizationID),
		OrgName:      r0.OrgName,
		Role:         r0.Role,
	}, nil
}

func (r *UserRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.User, error) {
	const q = `
		SELECT
			u.id, u.email, u.display_name, u.password_hash, u.status,
			om.organization_id,
			COALESCE(o.name, '') AS org_name,
			COALESCE(om.role::text, 'developer') AS role
		FROM users u
		LEFT JOIN organization_members om ON om.user_id = u.id
		LEFT JOIN organizations o ON o.id = om.organization_id AND o.deleted_at IS NULL
		WHERE u.id = $1 AND u.deleted_at IS NULL
		ORDER BY om.joined_at ASC NULLS LAST
		LIMIT 1`

	type row struct {
		ID             uuid.UUID      `db:"id"`
		Email          string         `db:"email"`
		DisplayName    string         `db:"display_name"`
		PasswordHash   sql.NullString `db:"password_hash"`
		Status         string         `db:"status"`
		OrganizationID uuid.NullUUID  `db:"organization_id"`
		OrgName        string         `db:"org_name"`
		Role           string         `db:"role"`
	}

	var r0 row
	if err := r.db.GetContext(ctx, &r0, q, id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}

	return &domain.User{
		ID:           r0.ID,
		Email:        r0.Email,
		DisplayName:  r0.DisplayName,
		PasswordHash: r0.PasswordHash.String,
		Active:       r0.Status == "active",
		OrgID:        nullableUUID(r0.OrganizationID),
		OrgName:      r0.OrgName,
		Role:         r0.Role,
	}, nil
}

func (r *UserRepository) CreateWithOrganization(
	ctx context.Context,
	email string,
	displayName string,
	password string,
	orgName string,
) (*domain.User, error) {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	userID := uuid.New()
	organizationID := uuid.New()
	resolvedOrgName := strings.TrimSpace(orgName)
	if resolvedOrgName == "" {
		resolvedOrgName = displayName + "'s Organization"
	}

	const insertUser = `
		INSERT INTO users (id, email, display_name, password_hash, status, email_verified)
		VALUES ($1, $2, $3, $4, 'active', TRUE)`
	if _, err = tx.ExecContext(ctx, insertUser, userID, email, displayName, string(passwordHash)); err != nil {
		return nil, fmt.Errorf("insert user: %w", err)
	}

	slug := buildOrganizationSlug(resolvedOrgName)
	const insertOrg = `
		INSERT INTO organizations (id, name, slug, plan_type)
		VALUES ($1, $2, $3, 'free')`
	if _, err = tx.ExecContext(ctx, insertOrg, organizationID, resolvedOrgName, slug); err != nil {
		return nil, fmt.Errorf("insert organization: %w", err)
	}

	const insertMember = `
		INSERT INTO organization_members (id, organization_id, user_id, role)
		VALUES ($1, $2, $3, 'admin')`
	if _, err = tx.ExecContext(ctx, insertMember, uuid.New(), organizationID, userID); err != nil {
		return nil, fmt.Errorf("insert organization member: %w", err)
	}

	if err = tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit tx: %w", err)
	}

	return &domain.User{
		ID:          userID,
		Email:       email,
		DisplayName: displayName,
		Active:      true,
		OrgID:       &organizationID,
		OrgName:     resolvedOrgName,
		Role:        "admin",
	}, nil
}

var nonSlugChars = regexp.MustCompile(`[^a-z0-9]+`)

func buildOrganizationSlug(name string) string {
	base := strings.ToLower(strings.TrimSpace(name))
	base = nonSlugChars.ReplaceAllString(base, "-")
	base = strings.Trim(base, "-")
	if base == "" {
		base = "organization"
	}
	return fmt.Sprintf("%s-%s", base, strings.ToLower(uuid.NewString()[:8]))
}

func nullableUUID(v uuid.NullUUID) *uuid.UUID {
	if !v.Valid {
		return nil
	}
	id := v.UUID
	return &id
}
