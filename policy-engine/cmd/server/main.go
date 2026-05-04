package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"github.com/xcloudapim/policy-engine/internal/compiler"
	"github.com/xcloudapim/policy-engine/internal/config"
	"github.com/xcloudapim/policy-engine/internal/executor"
	grpcserver "github.com/xcloudapim/policy-engine/internal/grpc"
	"github.com/xcloudapim/policy-engine/internal/plugins"
	"github.com/xcloudapim/policy-engine/internal/store"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "config load: %v\n", err)
		os.Exit(1)
	}

	log := initLogger(cfg.Server.Environment)
	defer log.Sync() //nolint:errcheck

	// ─── PostgreSQL ───────────────────────────────────────────
	db, err := sqlx.Connect("postgres", cfg.Postgres.DSN)
	if err != nil {
		log.Fatal("postgres connect", zap.Error(err))
	}
	db.SetMaxOpenConns(cfg.Postgres.MaxConns)
	db.SetMaxIdleConns(cfg.Postgres.MaxConns / 2)
	db.SetConnMaxLifetime(5 * time.Minute)
	defer db.Close()

	// ─── Redis ────────────────────────────────────────────────
	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.Redis.Addr,
		Password: cfg.Redis.Password,
		DB:       cfg.Redis.DB,
	})
	ctx := context.Background()
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Fatal("redis ping", zap.Error(err))
	}
	defer rdb.Close()

	// ─── Plugin Registry ──────────────────────────────────────
	registry := plugins.NewRegistry()
	registry.Register(plugins.NewJWTAuthPlugin(cfg.Auth.JWKSEndpoint, cfg.Auth.JWKSCacheTTL))
	registry.Register(plugins.NewRateLimitPlugin(rdb))
	registry.Register(plugins.NewCORSPlugin())
	registry.Register(plugins.NewRequestTransformPlugin())
	registry.Register(plugins.NewResponseTransformPlugin())
	registry.Register(plugins.NewIPWhitelistPlugin())
	registry.Register(plugins.NewCachePlugin(rdb))
	registry.Register(plugins.NewCircuitBreakerPlugin(rdb))

	log.Info("plugins registered", zap.Int("count", len(registry.Types())))

	// ─── Chain Store + Cache ──────────────────────────────────
	chainStore := store.NewChainStore(db)
	chainCache := store.NewChainCache(rdb)
	chainRepo  := store.NewChainRepository(chainStore, chainCache)

	// ─── Compiler + Executor ─────────────────────────────────
	comp := compiler.New(registry)
	exec := executor.New(registry, log)

	// ─── gRPC Server ──────────────────────────────────────────
	grpcPort := 50051
	fmt.Sscanf(cfg.Server.GRPCPort, "%d", &grpcPort)
	handler   := grpcserver.NewHandler(chainRepo, comp, exec, log)
	grpcSrv   := grpcserver.NewServer(handler, log, grpcPort)

	// ─── HTTP (健康檢查 + Prometheus) ─────────────────────────
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`)) //nolint:errcheck
	})
	mux.Handle("/metrics", promhttp.Handler())
	httpSrv := &http.Server{
		Addr:    ":" + cfg.Server.HTTPPort,
		Handler: mux,
	}

	// ─── 啟動 ─────────────────────────────────────────────────
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Info("HTTP server starting", zap.String("addr", httpSrv.Addr))
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal("http server error", zap.Error(err))
		}
	}()

	go func() {
		if err := grpcSrv.Start(); err != nil {
			log.Fatal("grpc server error", zap.Error(err))
		}
	}()

	<-quit
	log.Info("shutting down")

	// Graceful shutdown
	grpcSrv.Stop()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		log.Warn("http shutdown", zap.Error(err))
	}

	log.Info("policy-engine stopped")
}

func initLogger(env string) *zap.Logger {
	var cfg zap.Config
	if env == "production" {
		cfg = zap.NewProductionConfig()
		cfg.EncoderConfig.TimeKey = "ts"
		cfg.EncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder
	} else {
		cfg = zap.NewDevelopmentConfig()
		cfg.EncoderConfig.EncodeLevel = zapcore.CapitalColorLevelEncoder
	}
	log, _ := cfg.Build()
	return log
}
