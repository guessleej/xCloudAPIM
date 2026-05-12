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
func InternalAuth() gin.HandlerFunc {
	secret := os.Getenv("INTERNAL_SERVICE_SECRET")
	if secret == "" {
		panic("INTERNAL_SERVICE_SECRET is not set — internal endpoints are unprotected")
	}

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
		if subtle.ConstantTimeCompare([]byte(token), []byte(expectedToken)) != 1 {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error": "invalid internal token",
			})
			return
		}
		c.Next()
	}
}
