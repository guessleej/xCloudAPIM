// Package mtls 提供服務間 mTLS 的 TLS 設定（P3-3）。
// 由 MTLS_ENABLED=true 啟用；憑證自 MTLS_CERT_DIR（預設 /etc/mtls）讀取：
//
//	ca.crt（內部 CA）、service.crt + service.key（共用服務憑證，server/client 兩用）。
package mtls

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"
	"strings"
)

func Enabled() bool { return strings.EqualFold(os.Getenv("MTLS_ENABLED"), "true") }

func dir() string {
	if d := os.Getenv("MTLS_CERT_DIR"); d != "" {
		return d
	}
	return "/etc/mtls"
}

func caPool() (*x509.CertPool, error) {
	ca, err := os.ReadFile(dir() + "/ca.crt")
	if err != nil {
		return nil, fmt.Errorf("read ca.crt: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(ca) {
		return nil, fmt.Errorf("append CA cert failed")
	}
	return pool, nil
}

func keypair() (tls.Certificate, error) {
	return tls.LoadX509KeyPair(dir()+"/service.crt", dir()+"/service.key")
}

// ServerTLSConfig 回傳 mTLS server 設定（要求並驗證 client 憑證）。
func ServerTLSConfig() (*tls.Config, error) {
	cert, err := keypair()
	if err != nil {
		return nil, err
	}
	pool, err := caPool()
	if err != nil {
		return nil, err
	}
	return &tls.Config{
		Certificates: []tls.Certificate{cert},
		ClientCAs:    pool,
		ClientAuth:   tls.RequireAndVerifyClientCert,
		MinVersion:   tls.VersionTLS12,
	}, nil
}

// ClientTLSConfig 回傳 mTLS client 設定（提供 client 憑證並驗證 server）。
func ClientTLSConfig() (*tls.Config, error) {
	cert, err := keypair()
	if err != nil {
		return nil, err
	}
	pool, err := caPool()
	if err != nil {
		return nil, err
	}
	return &tls.Config{
		Certificates: []tls.Certificate{cert},
		RootCAs:      pool,
		MinVersion:   tls.VersionTLS12,
	}, nil
}
