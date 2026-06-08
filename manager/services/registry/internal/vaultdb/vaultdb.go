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

	host := getenv("POSTGRES_HOST", "postgres")
	port := getenv("POSTGRES_PORT", "5432")
	dbname := getenv("POSTGRES_DB", "apim")
	ssl := getenv("POSTGRES_SSL_MODE", "require")
	sslRoot := os.Getenv("POSTGRES_SSL_ROOT_CERT") // 設定時啟用 verify-full 鏈驗證（Phase 5）
	baseDSN := func(u, p string) string {
		dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s", host, port, u, p, dbname, ssl)
		if sslRoot != "" {
			dsn += " sslrootcert=" + sslRoot
		}
		return dsn
	}

	m := &Manager{
		vc:        vc,
		credsPath: getenv("VAULT_DB_CREDS_PATH", "database/creds/apim-dyn"),
		baseDSN:   baseDSN,
		log:       log,
		stop:      make(chan struct{}),
	}
	if err := m.vaultLogin(); err != nil {
		return nil, err
	}
	if err := m.refresh(); err != nil {
		return nil, err
	}
	go m.renewLoop()
	return m, nil
}

// vaultLogin 取得 Vault token：有 VAULT_ROLE_ID/VAULT_SECRET_ID 則走 AppRole（並啟動
// token 續租），否則沿用 VAULT_TOKEN。AppRole 失敗時 fallback root token（漸進遷移）。
func (m *Manager) vaultLogin() error {
	roleID := os.Getenv("VAULT_ROLE_ID")
	secretID := os.Getenv("VAULT_SECRET_ID")
	if roleID == "" || secretID == "" {
		m.vc.SetToken(os.Getenv("VAULT_TOKEN"))
		return nil
	}
	if err := m.appRoleLogin(roleID, secretID); err != nil {
		if t := os.Getenv("VAULT_TOKEN"); t != "" {
			m.log.Warn("AppRole login failed, falling back to VAULT_TOKEN", zap.Error(err))
			m.vc.SetToken(t)
			return nil
		}
		return err
	}
	go m.tokenRenewLoop(roleID, secretID)
	return nil
}

func (m *Manager) appRoleLogin(roleID, secretID string) error {
	sec, err := m.vc.Logical().Write("auth/approle/login", map[string]interface{}{
		"role_id": roleID, "secret_id": secretID,
	})
	if err != nil {
		return err
	}
	if sec == nil || sec.Auth == nil || sec.Auth.ClientToken == "" {
		return fmt.Errorf("approle login: empty token")
	}
	m.vc.SetToken(sec.Auth.ClientToken)
	m.log.Info("vault AppRole login ok", zap.Int("token_ttl_s", sec.Auth.LeaseDuration))
	return nil
}

// tokenRenewLoop 定期 renew-self 維持 periodic token；失敗則重新 AppRole 登入。
func (m *Manager) tokenRenewLoop(roleID, secretID string) {
	for {
		select {
		case <-m.stop:
			return
		case <-time.After(30 * time.Minute):
		}
		if _, err := m.vc.Auth().Token().RenewSelf(0); err != nil {
			m.log.Warn("vault token renew-self failed, re-login", zap.Error(err))
			if lerr := m.appRoleLogin(roleID, secretID); lerr != nil {
				m.log.Error("vault AppRole re-login failed", zap.Error(lerr))
			}
		}
	}
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
