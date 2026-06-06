package middleware

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// 安全測試 — 對應 docs/security/07-security-testing.md §3
// 驗證內部服務驗證中介層（X-Internal-Token）的 fail-closed 行為。

func setupRouter(t *testing.T) *gin.Engine {
	t.Helper()
	t.Setenv("INTERNAL_SERVICE_SECRET", "test-internal-secret")
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(InternalAuth())
	r.GET("/protected", func(c *gin.Context) { c.Status(http.StatusOK) })
	return r
}

func expectedToken() string {
	h := sha256.Sum256([]byte("test-internal-secret"))
	return hex.EncodeToString(h[:])
}

func TestInternalAuth_RejectsMissingToken(t *testing.T) {
	r := setupRouter(t)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("缺 token 應回 401，實際 %d", w.Code)
	}
}

func TestInternalAuth_RejectsWrongToken(t *testing.T) {
	r := setupRouter(t)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.Header.Set("X-Internal-Token", "deadbeef")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("錯誤 token 應回 403，實際 %d", w.Code)
	}
}

func TestInternalAuth_AcceptsValidToken(t *testing.T) {
	r := setupRouter(t)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.Header.Set("X-Internal-Token", expectedToken())
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("正確 token 應放行 200，實際 %d", w.Code)
	}
}
