package vault

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"testing"
)

// thumbprint 必須具決定性（同金鑰同 kid）且不同金鑰得不同 kid。
func TestThumbprintDeterministicAndUnique(t *testing.T) {
	k1, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("gen k1: %v", err)
	}
	k2, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("gen k2: %v", err)
	}

	a := thumbprint(&k1.PublicKey)
	b := thumbprint(&k1.PublicKey)
	if a == "" {
		t.Fatal("thumbprint 不應為空")
	}
	if a != b {
		t.Errorf("同一公鑰指紋不一致：%s != %s", a, b)
	}

	c := thumbprint(&k2.PublicKey)
	if a == c {
		t.Error("不同公鑰指紋不應相同（kid 撞鍵）")
	}
}

// parseRSAPublicKey 應能還原 RotateJWTKey 寫出的 PKIX 公鑰格式（round-trip）。
func TestParseRSAPublicKeyRoundTrip(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("gen: %v", err)
	}
	pub := &key.PublicKey

	// 以與 RotateJWTKey 相同方式輸出 PEM（PKIX）
	der, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	pubPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})
	parsed, err := parseRSAPublicKey(pubPEM)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if parsed.N.Cmp(pub.N) != 0 || parsed.E != pub.E {
		t.Error("round-trip 後公鑰不一致")
	}
	if thumbprint(parsed) != thumbprint(pub) {
		t.Error("round-trip 後指紋不一致")
	}
}
