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
	OTEL     OTELConfig
	Auth     AuthConfig
}

type ServerConfig struct {
	GRPCPort    string
	HTTPPort    string
	Environment string
}

type PostgresConfig struct {
	DSN      string
	MaxConns int
}

type RedisConfig struct {
	Addr     string
	Password string
	DB       int
	// Policy chain cache TTL
	ChainCacheTTL time.Duration
}

type OTELConfig struct {
	Endpoint    string
	ServiceName string
}

// AuthConfig 用於 JWT Auth Plugin 取得 JWKS
type AuthConfig struct {
	JWKSEndpoint string
	JWKSCacheTTL time.Duration
}

func Load() (*Config, error) {
	return &Config{
		Server: ServerConfig{
			GRPCPort:    getEnv("POLICY_ENGINE_GRPC_PORT", "50051"),
			HTTPPort:    getEnv("POLICY_ENGINE_PORT", "8083"),
			Environment: getEnv("GO_ENV", "development"),
		},
		Postgres: PostgresConfig{
			DSN: fmt.Sprintf(
				"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
				getEnv("POSTGRES_HOST", "localhost"),
				getEnv("POSTGRES_PORT", "5432"),
				getEnv("POSTGRES_USER", "apim_user"),
				getEnv("POSTGRES_PASSWORD", "apim_pass_dev"),
				getEnv("POSTGRES_DB", "apim"),
				getEnv("POSTGRES_SSL_MODE", "disable"),
			),
			MaxConns: getEnvInt("POSTGRES_MAX_CONNS", 10),
		},
		Redis: RedisConfig{
			Addr:          fmt.Sprintf("%s:%s", getEnv("REDIS_HOST", "localhost"), getEnv("REDIS_PORT", "6379")),
			Password:      getEnv("REDIS_PASSWORD", "redis_pass_dev"),
			DB:            getEnvInt("REDIS_DB", 0),
			ChainCacheTTL: time.Duration(getEnvInt("POLICY_CACHE_TTL_SECONDS", 60)) * time.Second,
		},
		OTEL: OTELConfig{
			Endpoint:    getEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318"),
			ServiceName: getEnv("OTEL_SERVICE_NAME", "policy-engine"),
		},
		Auth: AuthConfig{
			JWKSEndpoint: getEnv("AUTH_JWKS_URL", "http://auth-service:8081/oauth2/jwks"),
			JWKSCacheTTL: time.Duration(getEnvInt("JWKS_CACHE_TTL_SECONDS", 300)) * time.Second,
		},
	}, nil
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
