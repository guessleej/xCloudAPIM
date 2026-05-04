module github.com/xcloudapim/policy-engine

go 1.22

require (
	github.com/google/uuid v1.6.0
	github.com/jmoiron/sqlx v1.3.5
	github.com/lib/pq v1.10.9
	github.com/prometheus/client_golang v1.19.0
	github.com/redis/go-redis/v9 v9.5.1
	go.opentelemetry.io/otel v1.24.0
	go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp v1.24.0
	go.opentelemetry.io/otel/sdk v1.24.0
	go.uber.org/zap v1.27.0
	golang.org/x/net v0.23.0
	google.golang.org/grpc v1.63.2
	google.golang.org/protobuf v1.34.0
	gopkg.in/yaml.v3 v3.0.1
)
