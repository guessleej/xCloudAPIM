package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"
	_ "github.com/lib/pq"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"github.com/xcloudapim/subscription-service/internal/cache"
	"github.com/xcloudapim/subscription-service/internal/config"
	grpcserver "github.com/xcloudapim/subscription-service/internal/grpc"
	"github.com/xcloudapim/subscription-service/internal/handler"
	"github.com/xcloudapim/subscription-service/internal/repository"
	"github.com/xcloudapim/subscription-service/internal/service"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "config: %v\n", err)
		os.Exit(1)
	}

	log := initLogger(cfg.Server.Environment)
	defer log.Sync() //nolint:errcheck

	// ─── PostgreSQL ───────────────────────────────────────────
	db, err := repository.NewDB(cfg.Postgres.DSN, cfg.Postgres.MaxConns)
	if err != nil {
		log.Fatal("postgres", zap.Error(err))
	}
	defer db.Close()

	// ─── Redis ────────────────────────────────────────────────
	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.Redis.Addr,
		Password: cfg.Redis.Password,
		DB:       cfg.Redis.DB,
	})
	ctx := context.Background()
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Fatal("redis", zap.Error(err))
	}
	defer rdb.Close()

	// ─── Repositories ─────────────────────────────────────────
	planRepo  := repository.NewPlanRepo(db)
	subRepo   := repository.NewSubscriptionRepo(db)
	keyRepo   := repository.NewAPIKeyRepo(db)
	quotaRepo := repository.NewQuotaRepo(db)

	// ─── Cache ────────────────────────────────────────────────
	quotaCache := cache.NewQuotaCache(rdb)

	// ─── Services ─────────────────────────────────────────────
	subSvc   := service.NewSubscriptionService(subRepo, planRepo)
	keySvc   := service.NewAPIKeyService(keyRepo, subRepo, planRepo, quotaCache)
	quotaSvc := service.NewQuotaService(quotaRepo, subRepo, planRepo, quotaCache, log)

	// ─── HTTP ─────────────────────────────────────────────────
	subH   := handler.NewSubscriptionHandler(subSvc)
	keyH   := handler.NewAPIKeyHandler(keySvc)
	quotaH := handler.NewQuotaHandler(quotaSvc)
	router := handler.NewRouter(subH, keyH, quotaH, log, cfg.Server.Environment)

	httpSrv := &http.Server{
		Addr:         ":" + cfg.Server.Port,
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}

	// ─── gRPC ─────────────────────────────────────────────────
	grpcPort := 50052
	fmt.Sscanf(cfg.Server.GRPCPort, "%d", &grpcPort)
	grpcSrv := grpcserver.NewServer(quotaSvc, log, grpcPort)

	// ─── 啟動 ─────────────────────────────────────────────────
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Info("HTTP server starting", zap.String("addr", httpSrv.Addr))
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal("http", zap.Error(err))
		}
	}()

	go func() {
		if err := grpcSrv.Start(); err != nil {
			log.Fatal("grpc", zap.Error(err))
		}
	}()

	<-quit
	log.Info("shutting down")

	grpcSrv.Stop()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		log.Warn("http shutdown", zap.Error(err))
	}

	log.Info("subscription-service stopped")
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
	l, _ := cfg.Build()
	return l
}
