package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"
	"go.uber.org/zap"

	"github.com/xcloudapim/policy-engine/internal/vaultdb"
)

type DB struct {
	*sqlx.DB
	logger *zap.Logger
}

func NewDB(dsn string, maxConns, minConns int, logger *zap.Logger) (*DB, error) {
	var db *sqlx.DB
	if vaultdb.Enabled() {
		conn, cerr := vaultdb.NewConnector(logger)
		if cerr != nil {
			return nil, fmt.Errorf("vault dynamic db creds: %w", cerr)
		}
		db = sqlx.NewDb(sql.OpenDB(conn), "postgres")
	} else {
		var cerr error
		db, cerr = sqlx.Connect("postgres", dsn)
		if cerr != nil {
			return nil, fmt.Errorf("connect postgres: %w", cerr)
		}
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
