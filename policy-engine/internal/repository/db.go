package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"
	"go.uber.org/zap"
)

type DB struct {
	*sqlx.DB
	logger *zap.Logger
}

func NewDB(dsn string, maxConns, minConns int, logger *zap.Logger) (*DB, error) {
	db, err := sqlx.Connect("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("connect postgres: %w", err)
	}
	db.SetMaxOpenConns(maxConns)
	db.SetMaxIdleConns(minConns)
	db.SetConnMaxLifetime(30 * time.Minute)
	db.SetConnMaxIdleTime(5 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	logger.Info("PostgreSQL connected")
	return &DB{DB: db, logger: logger}, nil
}
