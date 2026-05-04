module github.com/xcloudapim/registry-service

go 1.22

require (
	github.com/gin-gonic/gin v1.9.1
	github.com/google/uuid v1.6.0
	github.com/jmoiron/sqlx v1.3.5
	github.com/lib/pq v1.10.9
	github.com/prometheus/client_golang v1.19.0
	github.com/segmentio/kafka-go v0.4.47
	go.opentelemetry.io/contrib/instrumentation/github.com/gin-gonic/gin/otelgin v0.49.0
	go.opentelemetry.io/otel v1.24.0
	go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp v1.24.0
	go.opentelemetry.io/otel/sdk v1.24.0
	go.uber.org/zap v1.27.0
	gopkg.in/yaml.v3 v3.0.1
)
