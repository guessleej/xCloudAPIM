package service

import "testing"

func TestVerifyPKCERequiresS256(t *testing.T) {
	verifier := "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~"
	challenge := GenerateCodeChallenge(verifier)

	if err := VerifyPKCE(verifier, challenge, "S256"); err != nil {
		t.Fatalf("S256 PKCE should pass: %v", err)
	}

	if err := VerifyPKCE(verifier, verifier, "plain"); err == nil {
		t.Fatal("plain PKCE must be rejected")
	}
}
