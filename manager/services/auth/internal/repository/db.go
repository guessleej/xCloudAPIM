package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"
	"go.uber.org/zap"

	"github.com/xcloudapim/auth-service/internal/vaultdb"
)

type DB struct {
	*sqlx.DB
	logger *zap.Logger
}

func NewDB(dsn string, maxConns, minConns int, logger *zap.Logger) (*DB, error) {
	var db *sqlx.DB
	if vaultdb.Enabled() {
		// VAULT_DB_CREDS=true：以 Vault 動態簽發的 postgres 帳密連線（背景續租/輪轉）
		conn, err := vaultdb.NewConnector(logger)
		if err != nil {
			return nil, fmt.Errorf("vault dynamic db creds: %w", err)
		}
		db = sqlx.NewDb(sql.OpenDB(conn), "postgres")
	} else {
		var err error
		db, err = sqlx.Connect("postgres", dsn)
		if err != nil {
			return nil, fmt.Errorf("connect to postgres: %w", err)
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
