package repository

import (
	"database/sql"
	"time"

	"github.com/jmoiron/sqlx"
	"go.uber.org/zap"

	"github.com/xcloudapim/subscription-service/internal/vaultdb"
)

func NewDB(dsn string, maxConns int) (*sqlx.DB, error) {
	var db *sqlx.DB
	if vaultdb.Enabled() {
		conn, cerr := vaultdb.NewConnector(zap.NewNop())
		if cerr != nil {
			return nil, cerr
		}
		db = sqlx.NewDb(sql.OpenDB(conn), "postgres")
	} else {
		var cerr error
		db, cerr = sqlx.Connect("postgres", dsn)
		if cerr != nil {
			return nil, cerr
		}
	}
	db.SetMaxOpenConns(maxConns)
	db.SetMaxIdleConns(maxConns / 2)
	db.SetConnMaxLifetime(5 * time.Minute)
	return db, nil
}
