package audit

import (
	"testing"

	"go.uber.org/zap"
)

// KAFKA_BROKERS 未設時 Init 應停用（writer 為 nil），Emit 變安全 no-op。
func TestInitDisabledWithoutBrokers(t *testing.T) {
	t.Setenv("KAFKA_BROKERS", "")
	writer = nil
	Init(zap.NewNop())
	if writer != nil {
		t.Fatal("KAFKA_BROKERS 未設時 writer 應為 nil（停用）")
	}
}

// 未初始化（writer==nil）時 Emit 必須安全：不 panic、不阻塞、不寫入。
func TestEmitNoopWhenUninitialized(t *testing.T) {
	writer = nil
	Emit("login_failed", "actor@example.com", "1.2.3.4", map[string]any{"result": "failure"})
	Emit("logout", "", "", nil)
	// 走到這裡即代表 best-effort 契約成立（稽核失敗不影響請求路徑）。
}
