package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)


type Config struct {
	Server   ServerConfig
	Postgres PostgresConfig
	Redis    RedisConfig
	Vault    VaultConfig
	JWT      JWTConfig
	Session  SessionConfig
	OTEL     OTELConfig
}

type ServerConfig struct {
	Port         string
	GRPCPort     string
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
	Environment  string
}

type PostgresConfig struct {
	DSN      string
	MaxConns int
	MinConns int
}

type RedisConfig struct {
	Addr     string
	Password string
	DB       int
}

type VaultConfig struct {
	Addr          string
	Token         string
	JWTSecretPath string
	DBSecretPath  string
}

type JWTConfig struct {
	Issuer          string
	AccessTokenTTL  time.Duration
	RefreshTokenTTL time.Duration
	AuthCodeTTL     time.Duration
}

type SessionConfig struct {
	Secret string
}

type OTELConfig struct {
	Endpoint    string
	ServiceName string
}

func Load() (*Config, error) {
	cfg := &Config{
		Server: ServerConfig{
			Port:         getEnv("AUTH_SERVICE_PORT", "8081"),
			GRPCPort:     getEnv("AUTH_SERVICE_GRPC_PORT", "9081"),
			ReadTimeout:  30 * time.Second,
			WriteTimeout: 30 * time.Second,
			Environment:  getEnv("GO_ENV", "development"),
		},
		Postgres: PostgresConfig{
			DSN: fmt.Sprintf(
				"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
				getEnv("POSTGRES_HOST", "localhost"),
				getEnv("POSTGRES_PORT", "5432"),
				getEnv("POSTGRES_USER", "apim_user"),
				getEnv("POSTGRES_PASSWORD", ""),
				getEnv("POSTGRES_DB", "apim"),
				getEnv("POSTGRES_SSL_MODE", "disable"),
			),
			MaxConns: getEnvInt("POSTGRES_MAX_CONNS", 20),
			MinConns: getEnvInt("POSTGRES_MIN_CONNS", 5),
		},
		Redis: RedisConfig{
			Addr:     fmt.Sprintf("%s:%s", getEnv("REDIS_HOST", "localhost"), getEnv("REDIS_PORT", "6379")),
			Password: getEnv("REDIS_PASSWORD", ""),
			DB:       getEnvInt("REDIS_DB", 0),
		},
		Vault: VaultConfig{
			Addr:          getEnv("VAULT_ADDR", "http://localhost:8200"),
			Token:         getEnv("VAULT_TOKEN", ""),
			JWTSecretPath: getEnv("VAULT_JWT_KEY_PATH", "secret/data/jwt"),
			DBSecretPath:  getEnv("VAULT_DB_SECRET_PATH", "secret/data/database/postgres"),
		},
		JWT: JWTConfig{
			Issuer:          getEnv("JWT_ISSUER", "https://auth.xcloudapim.local"),
			AccessTokenTTL:  time.Duration(getEnvInt("JWT_ACCESS_TOKEN_TTL", 3600)) * time.Second,
			RefreshTokenTTL: time.Duration(getEnvInt("JWT_REFRESH_TOKEN_TTL", 86400)) * time.Second,
			AuthCodeTTL:     600 * time.Second,
		},
		Session: SessionConfig{
			Secret: getEnv("SESSION_SECRET", ""),
		},
		OTEL: OTELConfig{
			Endpoint:    getEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318"),
			ServiceName: getEnv("OTEL_SERVICE_NAME", "auth-service"),
		},
	}
	if cfg.Session.Secret == "" {
		return nil, fmt.Errorf("SESSION_SECRET is required (min 32 chars)")
	}
	if len(cfg.Session.Secret) < 32 {
		return nil, fmt.Errorf("SESSION_SECRET must be at least 32 characters")
	}
	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return fallback
}
