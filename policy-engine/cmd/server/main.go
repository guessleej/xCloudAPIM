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

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"github.com/xcloudapim/policy-engine/internal/compiler"
	"github.com/xcloudapim/policy-engine/internal/config"
	grpcserver "github.com/xcloudapim/policy-engine/internal/grpc"
	"github.com/xcloudapim/policy-engine/internal/handler"
	"github.com/xcloudapim/policy-engine/internal/plugins"
	"github.com/xcloudapim/policy-engine/internal/repository"
	"github.com/xcloudapim/policy-engine/internal/service"
	"github.com/xcloudapim/policy-engine/internal/store"
	"github.com/xcloudapim/policy-engine/internal/executor"

	_ "github.com/lib/pq"
)

var (
	Version   = "dev"
	BuildDate = "unknown"
)

func main() {
	logger := buildLogger()
	defer logger.Sync() //nolint:errcheck

	logger.Info("xCloudAPIM Policy Engine starting",
		zap.String("version", Version),
		zap.String("build_date", BuildDate),
	)

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

	// ─── Redis ────────────────────────────────────────────────
	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.Redis.Addr,
		Password: cfg.Redis.Password,
		DB:       cfg.Redis.DB,
	})
	ctx5, cancel5 := context.WithTimeout(context.Background(), 5*time.Second)
	if err := rdb.Ping(ctx5).Err(); err != nil {
		logger.Fatal("redis ping failed", zap.Error(err))
	}
	cancel5()
	defer rdb.Close()

	// ─── Store layer (read side: Redis L1 + PostgreSQL L2) ────
	chainStore := store.NewChainStore(db.DB)
	chainCache := store.NewChainCache(rdb)
	storeRepo := store.NewChainRepository(chainStore, chainCache)

	// ─── Management layer (write side: full CRUD) ─────────────
	mgmtRepo := repository.NewManagementRepo(db, logger)

	// ─── Plugin Registry ──────────────────────────────────────
	registry := plugins.NewRegistry()
	registry.Register(plugins.NewJWTAuthPlugin(
		cfg.Service.JWKSURL,
		5*time.Minute,
	))
	registry.Register(plugins.NewCachePlugin(rdb))
	registry.Register(plugins.NewCORSPlugin())
	registry.Register(plugins.NewIPWhitelistPlugin())
	registry.Register(plugins.NewRateLimitPlugin(rdb))
	registry.Register(plugins.NewCircuitBreakerPlugin(rdb))
	registry.Register(plugins.NewRequestTransformPlugin())
	registry.Register(plugins.NewResponseTransformPlugin())

	// ─── Executor & Compiler ─────────────────────────────────
	exec := executor.New(registry, logger)
	comp := compiler.New(registry)

	// ─── Chain Service ────────────────────────────────────────
	chainSvc := service.NewChainService(mgmtRepo, storeRepo, logger)

	// ─── HTTP Server ──────────────────────────────────────────
	h := handler.NewHandlers(chainSvc, db, logger)
	router := handler.SetupRouter(h, cfg.Server.Environment)

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%s", cfg.Server.Port),
		Handler:      router,
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
		IdleTimeout:  120 * time.Second,
	}

	// ─── gRPC Server ──────────────────────────────────────────
	grpcHandler := grpcserver.NewHandler(storeRepo, comp, exec, logger)
	grpcSrv := grpcserver.NewServer(grpcHandler, logger, cfg.Service.GRPCPort)

	// ─── Start servers ────────────────────────────────────────
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		logger.Info("HTTP server listening", zap.String("addr", srv.Addr))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatal("HTTP server error", zap.Error(err))
		}
	}()

	go func() {
		if err := grpcSrv.Start(); err != nil {
			logger.Error("gRPC server error", zap.Error(err))
		}
	}()

	<-quit
	logger.Info("shutting down policy engine...")

	grpcSrv.Stop()

	shutCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutCtx); err != nil {
		logger.Error("HTTP shutdown error", zap.Error(err))
	}
	logger.Info("policy engine stopped")
}

func buildLogger() *zap.Logger {
	if os.Getenv("APP_ENV") == "production" {
		cfg := zap.NewProductionConfig()
		cfg.EncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder
		l, _ := cfg.Build()
		return l
	}
	l, _ := zap.NewDevelopment()
	return l
}
