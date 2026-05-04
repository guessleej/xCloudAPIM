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
	Kafka    KafkaConfig
	OTEL     OTELConfig
}

type ServerConfig struct {
	Port        string
	GRPCPort    string
	Environment string
	ReadTimeout time.Duration
	WriteTimeout time.Duration
}

type PostgresConfig struct {
	DSN      string
	MaxConns int
	MinConns int
}

type KafkaConfig struct {
	Brokers          []string
	TopicAPIPublished string
	TopicAPIEvents    string
}

type OTELConfig struct {
	Endpoint    string
	ServiceName string
}

func Load() (*Config, error) {
	return &Config{
		Server: ServerConfig{
			Port:         getEnv("REGISTRY_SERVICE_PORT", "8082"),
			GRPCPort:     getEnv("REGISTRY_SERVICE_GRPC_PORT", "9082"),
			Environment:  getEnv("GO_ENV", "development"),
			ReadTimeout:  30 * time.Second,
			WriteTimeout: 30 * time.Second,
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
			MaxConns: getEnvInt("POSTGRES_MAX_CONNS", 20),
			MinConns: getEnvInt("POSTGRES_MIN_CONNS", 5),
		},
		Kafka: KafkaConfig{
			Brokers:          []string{getEnv("KAFKA_BROKERS", "localhost:9092")},
			TopicAPIPublished: getEnv("KAFKA_TOPIC_API_PUBLISHED", "api.published"),
			TopicAPIEvents:    getEnv("KAFKA_TOPIC_API_EVENTS", "api.events"),
		},
		OTEL: OTELConfig{
			Endpoint:    getEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318"),
			ServiceName: getEnv("OTEL_SERVICE_NAME", "registry-service"),
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
