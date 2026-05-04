package repository

import (
	"time"

	"github.com/jmoiron/sqlx"
)

func NewDB(dsn string, maxConns int) (*sqlx.DB, error) {
	db, err := sqlx.Connect("postgres", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(maxConns)
	db.SetMaxIdleConns(maxConns / 2)
	db.SetConnMaxLifetime(5 * time.Minute)
	return db, nil
}
