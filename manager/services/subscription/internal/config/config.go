package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	Server   ServerConfig
	Postgres PostgresConfig
	Redis    RedisConfig
	OTEL     OTELConfig
}

type ServerConfig struct {
	Port        string
	GRPCPort    string
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
}

type OTELConfig struct {
	Endpoint    string
	ServiceName string
}

func Load() (*Config, error) {
	return &Config{
		Server: ServerConfig{
			Port:        getEnv("SUBSCRIPTION_PORT", "8084"),
			GRPCPort:    getEnv("SUBSCRIPTION_GRPC_PORT", "50052"),
			Environment: getEnv("GO_ENV", "development"),
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
		},
		Redis: RedisConfig{
			Addr:     fmt.Sprintf("%s:%s", getEnv("REDIS_HOST", "localhost"), getEnv("REDIS_PORT", "6379")),
			Password: getEnv("REDIS_PASSWORD", ""),
			DB:       getEnvInt("REDIS_DB", 1), // DB 1 for subscription service
		},
		OTEL: OTELConfig{
			Endpoint:    getEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318"),
			ServiceName: getEnv("OTEL_SERVICE_NAME", "subscription-service"),
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
