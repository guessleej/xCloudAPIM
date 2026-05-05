package repository

import (
	"context"
	"database/sql"
	"errors"

	"github.com/google/uuid"
	"github.com/xcloudapim/auth-service/internal/domain"
)

type UserRepository struct {
	db *DB
}

func NewUserRepository(db *DB) *UserRepository {
	return &UserRepository{db: db}
}

func (r *UserRepository) GetByEmail(ctx context.Context, email string) (*domain.User, error) {
	const q = `
		SELECT id, email, display_name, password_hash, status
		FROM users
		WHERE email = $1 AND deleted_at IS NULL
		LIMIT 1`

	type row struct {
		ID           uuid.UUID      `db:"id"`
		Email        string         `db:"email"`
		DisplayName  string         `db:"display_name"`
		PasswordHash sql.NullString `db:"password_hash"`
		Status       string         `db:"status"`
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
	}, nil
}

func (r *UserRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.User, error) {
	const q = `
		SELECT id, email, display_name, password_hash, status
		FROM users
		WHERE id = $1 AND deleted_at IS NULL
		LIMIT 1`

	type row struct {
		ID           uuid.UUID      `db:"id"`
		Email        string         `db:"email"`
		DisplayName  string         `db:"display_name"`
		PasswordHash sql.NullString `db:"password_hash"`
		Status       string         `db:"status"`
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
	}, nil
}
