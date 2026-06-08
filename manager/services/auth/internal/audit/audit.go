// Package audit 發布稽核事件至 Kafka auth.events（供 audit-sink 寫入不可變稽核日誌，P3-1）。
// best-effort + 非同步：不阻塞、不影響登入延遲；KAFKA_BROKERS 未設時 Emit 為 no-op。
package audit

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"os"
	"strings"
	"time"

	"github.com/segmentio/kafka-go"
	"github.com/segmentio/kafka-go/sasl/plain"
	"go.uber.org/zap"
)

// kafkaTLS：有 Root CA（KAFKA_SSL_CA，預設 /etc/pki/rootCA.crt）則驗證 broker 憑證
// （verify-full，Phase 5）；否則 fallback skip-verify（可回滾）。
func kafkaTLS() *tls.Config {
	caPath := os.Getenv("KAFKA_SSL_CA")
	if caPath == "" {
		caPath = "/etc/pki/rootCA.crt"
	}
	if b, err := os.ReadFile(caPath); err == nil {
		pool := x509.NewCertPool()
		if pool.AppendCertsFromPEM(b) {
			return &tls.Config{RootCAs: pool, ServerName: "kafka", MinVersion: tls.VersionTLS12}
		}
	}
	return &tls.Config{InsecureSkipVerify: true} // #nosec G402 — CA 不存在時 fallback
}

// Topic 稽核事件 topic（與 audit-sink AUDIT_TOPICS 一致）。
const Topic = "auth.events"

var (
	writer *kafka.Writer
	log    *zap.Logger
)

// Init 初始化稽核事件 producer。KAFKA_BROKERS 未設則停用（Emit 變 no-op）。
func Init(logger *zap.Logger) {
	log = logger
	brokers := os.Getenv("KAFKA_BROKERS")
	if brokers == "" {
		if log != nil {
			log.Info("audit publisher disabled (KAFKA_BROKERS unset)")
		}
		return
	}
	w := &kafka.Writer{
		Addr:         kafka.TCP(strings.Split(brokers, ",")...),
		Topic:        Topic,
		Balancer:     &kafka.LeastBytes{},
		BatchTimeout: 10 * time.Millisecond,
		Async:        true, // 非阻塞：WriteMessages 立即回傳，錯誤走 ErrorLogger
		ErrorLogger: kafka.LoggerFunc(func(msg string, a ...interface{}) {
			if log != nil {
				log.Warn("audit kafka write error", zap.Any("args", a))
			}
		}),
	}
	if user := os.Getenv("KAFKA_SASL_USERNAME"); user != "" {
		w.Transport = &kafka.Transport{
			TLS:  kafkaTLS(),
			SASL: plain.Mechanism{Username: user, Password: os.Getenv("KAFKA_SASL_PASSWORD")},
		}
	}
	writer = w
	if log != nil {
		log.Info("audit event publisher initialized", zap.String("topic", Topic))
	}
}

// Emit 發布一筆稽核事件（best-effort、非同步）。
func Emit(eventType, actor, ip string, extra map[string]any) {
	if writer == nil {
		return
	}
	payload := map[string]any{
		"event_type": eventType,
		"actor":      actor,
		"ip":         ip,
		"ts":         time.Now().UTC().Format(time.RFC3339),
	}
	for k, v := range extra {
		payload[k] = v
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return
	}
	// 用 Background context 避免請求結束時取消非同步寫入
	_ = writer.WriteMessages(context.Background(), kafka.Message{Value: b})
}

// Close 關閉 producer（flush 待寫訊息）。
func Close() {
	if writer != nil {
		_ = writer.Close()
	}
}
