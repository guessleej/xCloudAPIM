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
	Service  ServiceConfig
}

type ServerConfig struct {
	Port         string
	Environment  string
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
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

type ServiceConfig struct {
	InternalSecret string
	RegistryURL    string
	JWKSURL        string
	GRPCPort       int
}

func Load() (*Config, error) {
	internalSecret := getEnv("INTERNAL_SERVICE_SECRET", "")
	if internalSecret == "" {
		return nil, fmt.Errorf("INTERNAL_SERVICE_SECRET is required")
	}

	cfg := &Config{
		Server: ServerConfig{
			Port:         getEnv("PORT", "8083"),
			Environment:  getEnv("APP_ENV", "development"),
			ReadTimeout:  30 * time.Second,
			WriteTimeout: 30 * time.Second,
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
			MaxConns: getEnvInt("POSTGRES_MAX_CONNS", 10),
			MinConns: getEnvInt("POSTGRES_MIN_CONNS", 2),
		},
		Redis: RedisConfig{
			Addr:     fmt.Sprintf("%s:%s", getEnv("REDIS_HOST", "localhost"), getEnv("REDIS_PORT", "6379")),
			Password: getEnv("REDIS_PASSWORD", ""),
			DB:       getEnvInt("REDIS_DB", 0),
		},
		Service: ServiceConfig{
			InternalSecret: internalSecret,
			RegistryURL:    getEnv("REGISTRY_SERVICE_URL", "http://localhost:8082"),
			JWKSURL:        getEnv("JWKS_URL", "http://auth-service:8081/oauth2/jwks"),
			GRPCPort:       getEnvInt("GRPC_PORT", 9083),
		},
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

