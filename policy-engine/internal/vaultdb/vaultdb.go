// Package vaultdb 提供「以 Vault 動態簽發的 postgres 帳密」建立 database/sql 連線。
//
// 設計（P2-B-2）：
//   - 自訂 driver.Connector：每次新連線都用「當下的動態帳密」撥接，故單一 *sql.DB
//     物件不變、無需熱換物件；憑證輪轉時新連線自動採用新帳密。
//   - 背景 renew lease（維持帳號有效至 max_ttl）；renew 失敗或接近到期則重新簽發
//     一組憑證並 swap connector（rotate）。
//   - 由 VAULT_DB_CREDS=true 啟用；未啟用時呼叫端沿用靜態 DSN（可隨時回滾）。
package vaultdb

import (
	"context"
	"database/sql/driver"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	vaultapi "github.com/hashicorp/vault/api"
	"github.com/lib/pq"
	"go.uber.org/zap"
)

// Enabled 回報是否啟用 Vault 動態 DB 憑證。
func Enabled() bool { return strings.EqualFold(os.Getenv("VAULT_DB_CREDS"), "true") }

func getenv(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

// Manager 同時實作 driver.Connector，並持有背景續租狀態。
type Manager struct {
	mu        sync.RWMutex
	connector driver.Connector
	leaseID   string
	leaseTTL  int

	vc        *vaultapi.Client
	credsPath string
	baseDSN   func(user, pass string) string
	log       *zap.Logger
	stop      chan struct{}
}

// NewConnector 取得動態憑證並回傳 connector（同時啟動背景續租）。
func NewConnector(log *zap.Logger) (*Manager, error) {
	cfg := vaultapi.DefaultConfig()
	cfg.Address = getenv("VAULT_ADDR", "http://vault:8200")
	vc, err := vaultapi.NewClient(cfg)
	if err != nil {
		return nil, fmt.Errorf("vault client: %w", err)
	}
	vc.SetToken(os.Getenv("VAULT_TOKEN"))

	host := getenv("POSTGRES_HOST", "postgres")
	port := getenv("POSTGRES_PORT", "5432")
	dbname := getenv("POSTGRES_DB", "apim")
	ssl := getenv("POSTGRES_SSL_MODE", "require")
	baseDSN := func(u, p string) string {
		return fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s", host, port, u, p, dbname, ssl)
	}

	m := &Manager{
		vc:        vc,
		credsPath: getenv("VAULT_DB_CREDS_PATH", "database/creds/apim-dyn"),
		baseDSN:   baseDSN,
		log:       log,
		stop:      make(chan struct{}),
	}
	if err := m.refresh(); err != nil {
		return nil, err
	}
	go m.renewLoop()
	return m, nil
}

// Connect 實作 driver.Connector：以當下的動態帳密撥接。
func (m *Manager) Connect(ctx context.Context) (driver.Conn, error) {
	m.mu.RLock()
	c := m.connector
	m.mu.RUnlock()
	return c.Connect(ctx)
}

func (m *Manager) Driver() driver.Driver { return &pq.Driver{} }

// Close 停止背景續租。
func (m *Manager) Close() { close(m.stop) }

// refresh 向 Vault 取得一組新動態憑證並 swap connector。
func (m *Manager) refresh() error {
	sec, err := m.vc.Logical().Read(m.credsPath)
	if err != nil {
		return fmt.Errorf("read dynamic db creds: %w", err)
	}
	if sec == nil || sec.Data == nil {
		return fmt.Errorf("no dynamic db creds at %s", m.credsPath)
	}
	user, _ := sec.Data["username"].(string)
	pass, _ := sec.Data["password"].(string)
	if user == "" || pass == "" {
		return fmt.Errorf("empty dynamic db creds")
	}
	conn, err := pq.NewConnector(m.baseDSN(user, pass))
	if err != nil {
		return fmt.Errorf("pq connector: %w", err)
	}
	m.mu.Lock()
	m.connector = conn
	m.leaseID = sec.LeaseID
	m.leaseTTL = sec.LeaseDuration
	m.mu.Unlock()
	m.log.Info("vault dynamic DB creds loaded", zap.String("db_user", user), zap.Int("lease_ttl_s", sec.LeaseDuration))
	return nil
}

// renewLoop 於 lease 一半 TTL 處續租；續租失敗則重新簽發並 swap。
func (m *Manager) renewLoop() {
	for {
		m.mu.RLock()
		ttl := m.leaseTTL
		leaseID := m.leaseID
		m.mu.RUnlock()
		if ttl <= 0 {
			ttl = 3600
		}
		wait := time.Duration(ttl/2) * time.Second
		if wait < 30*time.Second {
			wait = 30 * time.Second
		}
		select {
		case <-m.stop:
			return
		case <-time.After(wait):
		}
		// 嘗試續租；失敗（已達 max_ttl 或被撤銷）則重新簽發
		if _, err := m.vc.Sys().Renew(leaseID, 0); err != nil {
			m.log.Warn("vault lease renew failed, re-issuing dynamic creds", zap.Error(err))
			if rerr := m.refresh(); rerr != nil {
				m.log.Error("vault dynamic creds re-issue failed", zap.Error(rerr))
			}
		}
	}
}
