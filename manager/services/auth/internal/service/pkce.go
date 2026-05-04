package service

import (
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"unicode"

	"github.com/xcloudapim/auth-service/internal/domain"
)

// VerifyPKCE 驗證 PKCE code_verifier（RFC 7636）
func VerifyPKCE(codeVerifier, codeChallenge, method string) error {
	if err := validateCodeVerifier(codeVerifier); err != nil {
		return err
	}

	switch strings.ToUpper(method) {
	case "S256":
		// challenge = BASE64URL(SHA256(verifier))
		h := sha256.Sum256([]byte(codeVerifier))
		computed := base64.RawURLEncoding.EncodeToString(h[:])
		if computed != codeChallenge {
			return domain.ErrPKCEVerifyFailed
		}
	case "PLAIN":
		if codeVerifier != codeChallenge {
			return domain.ErrPKCEVerifyFailed
		}
	default:
		return domain.ErrInvalidRequest("unsupported code_challenge_method: " + method)
	}
	return nil
}

// GenerateCodeChallenge 產生 S256 code_challenge（測試用）
func GenerateCodeChallenge(verifier string) string {
	h := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(h[:])
}

// validateCodeVerifier 驗證 code_verifier 格式（RFC 7636 §4.1）
// 長度 43-128，字元限定 [A-Z a-z 0-9 - . _ ~]
func validateCodeVerifier(v string) error {
	if len(v) < 43 || len(v) > 128 {
		return domain.ErrInvalidRequest("code_verifier length must be 43-128 characters")
	}
	for _, ch := range v {
		if !unicode.IsLetter(ch) && !unicode.IsDigit(ch) &&
			ch != '-' && ch != '.' && ch != '_' && ch != '~' {
			return domain.ErrInvalidRequest("code_verifier contains invalid characters")
		}
	}
	return nil
}
