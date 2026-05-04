package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/xcloudapim/registry-service/internal/config"
	"github.com/xcloudapim/registry-service/internal/handler"
	"github.com/xcloudapim/registry-service/internal/kafka"
	"github.com/xcloudapim/registry-service/internal/repository"
	"github.com/xcloudapim/registry-service/internal/service"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

func main() {
	logger := buildLogger()
	defer logger.Sync() //nolint:errcheck

	logger.Info("xCloudAPIM Registry Service starting...")

	cfg, err := config.Load()
	if err != nil {
		logger.Fatal("load config", zap.Error(err))
	}

	// ─── PostgreSQL ───────────────────────────────────────────
	db, err := repository.NewDB(cfg.Postgres.DSN, cfg.Postgres.MaxConns, cfg.Postgres.MinConns, logger)
	if err != nil {
		logger.Fatal("init postgres", zap.Error(err))
	}
	defer db.Close()

	// ─── Kafka Producer ───────────────────────────────────────
	topics := []string{cfg.Kafka.TopicAPIPublished, cfg.Kafka.TopicAPIEvents}
	producer := kafka.NewProducer(cfg.Kafka.Brokers, topics, logger)
	defer producer.Close()

	// ─── Repositories ─────────────────────────────────────────
	apiRepo     := repository.NewAPIRepository(db)
	versionRepo := repository.NewVersionRepository(db)

	// ─── Services ─────────────────────────────────────────────
	specService := service.NewSpecService()
	apiService  := service.NewAPIService(
		apiRepo, versionRepo, specService,
		producer, cfg.Kafka.TopicAPIEvents,
		logger,
	)

	// ─── HTTP Server ──────────────────────────────────────────
	h      := handler.NewHandlers(apiService, logger)
	router := handler.SetupRouter(h, cfg.Server.Environment)

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%s", cfg.Server.Port),
		Handler:      router,
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
		IdleTimeout:  120 * time.Second,
	}

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		logger.Info("HTTP server listening", zap.String("addr", srv.Addr))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatal("server error", zap.Error(err))
		}
	}()

	<-quit
	logger.Info("shutting down registry service...")

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		logger.Error("shutdown error", zap.Error(err))
	}
	logger.Info("registry service stopped")
}

func buildLogger() *zap.Logger {
	if os.Getenv("GO_ENV") == "production" {
		cfg := zap.NewProductionConfig()
		cfg.EncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder
		l, _ := cfg.Build()
		return l
	}
	l, _ := zap.NewDevelopment()
	return l
}
