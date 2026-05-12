package middleware

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
)

// InternalAuth 驗證服務間呼叫的 X-Internal-Token header
// 服務間使用 HMAC-SHA256(secret) 的 hex 字串作為 token
// 設定方式：環境變數 INTERNAL_SERVICE_SECRET（與所有服務共用同一個值）
func InternalAuth() gin.HandlerFunc {
	secret := os.Getenv("INTERNAL_SERVICE_SECRET")
	if secret == "" {
		panic("INTERNAL_SERVICE_SECRET is not set — internal endpoints are unprotected")
	}

	// 預計算期望的 token（避免每次請求計算）
	h := sha256.Sum256([]byte(secret))
	expectedToken := hex.EncodeToString(h[:])

	return func(c *gin.Context) {
		token := c.GetHeader("X-Internal-Token")
		if token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "missing X-Internal-Token header",
			})
			return
		}

		// 使用常數時間比較，防止 timing attack
		if subtle.ConstantTimeCompare([]byte(token), []byte(expectedToken)) != 1 {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error": "invalid internal token",
			})
			return
		}

		c.Next()
	}
}
