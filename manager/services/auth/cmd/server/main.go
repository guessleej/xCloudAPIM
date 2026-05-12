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

	"github.com/xcloudapim/auth-service/internal/cache"
	"github.com/xcloudapim/auth-service/internal/config"
	"github.com/xcloudapim/auth-service/internal/handler"
	"github.com/xcloudapim/auth-service/internal/repository"
	"github.com/xcloudapim/auth-service/internal/service"
	"github.com/xcloudapim/auth-service/internal/vault"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

func main() {
	logger := buildLogger()
	defer logger.Sync() //nolint:errcheck

	logger.Info("xCloudAPIM Auth Service starting...")

	cfg, err := config.Load()
	if err != nil {
		logger.Fatal("load config failed", zap.Error(err))
	}

	// ─── Vault Client ─────────────────────────────────────────
	vaultCli, err := vault.NewClient(
		cfg.Vault.Addr,
		cfg.Vault.Token,
		cfg.Vault.JWTSecretPath,
		logger,
	)
	if err != nil {
		logger.Fatal("init vault client failed", zap.Error(err))
	}

	// 等待 Vault 就緒並預載 JWT Keys
	if err := waitForVault(vaultCli, logger); err != nil {
		logger.Fatal("vault not ready", zap.Error(err))
	}

	// ─── Redis Cache ──────────────────────────────────────────
	redisCache, err := cache.NewRedisCache(
		cfg.Redis.Addr,
		cfg.Redis.Password,
		cfg.Redis.DB,
		logger,
	)
	if err != nil {
		logger.Fatal("init redis failed", zap.Error(err))
	}
	defer redisCache.Close()

	// ─── PostgreSQL ───────────────────────────────────────────
	db, err := repository.NewDB(cfg.Postgres.DSN, cfg.Postgres.MaxConns, cfg.Postgres.MinConns, logger)
	if err != nil {
		logger.Fatal("init postgres failed", zap.Error(err))
	}
	defer db.Close()

	// Redis cluster only supports DB 0; keep rate-limit keys isolated by prefix.
	rateLimitRdb := redisCache.NewClient(0)

	// ─── Repositories ─────────────────────────────────────────
	clientRepo := repository.NewClientRepository(db)
	tokenRepo := repository.NewTokenRepository(db)
	userRepo := repository.NewUserRepository(db)

	// ─── Services ─────────────────────────────────────────────
	tokenService := service.NewTokenService(
		tokenRepo, redisCache, vaultCli,
		cfg.JWT.Issuer,
		cfg.JWT.AccessTokenTTL,
		cfg.JWT.RefreshTokenTTL,
		logger,
	)
	authService := service.NewAuthService(
		clientRepo, tokenService, redisCache,
		cfg.JWT.AuthCodeTTL,
		logger,
	)
	sessionService := service.NewSessionService(userRepo, redisCache, cfg.Session.Secret, logger)
	rateLimitStore := service.NewRedisRateLimitStore(rateLimitRdb)

	// ─── HTTP Server ──────────────────────────────────────────
	h := handler.NewHandlers(authService, sessionService, rateLimitStore, db, redisCache, logger)
	router := handler.SetupRouter(h, cfg.Server.Environment)

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%s", cfg.Server.Port),
		Handler:      router,
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
		IdleTimeout:  120 * time.Second,
	}

	// ─── Graceful Shutdown ────────────────────────────────────
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		logger.Info("HTTP server listening", zap.String("addr", srv.Addr))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatal("server error", zap.Error(err))
		}
	}()

	<-quit
	logger.Info("shutting down auth service...")

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		logger.Error("server shutdown error", zap.Error(err))
	}

	logger.Info("auth service stopped")
}

func waitForVault(v *vault.Client, logger *zap.Logger) error {
	const maxRetries = 15
	for i := range maxRetries {
		if err := v.Health(); err == nil {
			// 預載 JWT Keys
			if _, err := v.GetJWTKeyPair(); err != nil {
				logger.Warn("JWT keys not ready yet", zap.Error(err))
			} else {
				logger.Info("Vault ready and JWT keys loaded")
				return nil
			}
		}
		logger.Info("waiting for Vault...", zap.Int("attempt", i+1))
		time.Sleep(3 * time.Second)
	}
	return fmt.Errorf("vault not ready after %d attempts", maxRetries)
}

func buildLogger() *zap.Logger {
	env := os.Getenv("GO_ENV")
	if env == "production" {
		cfg := zap.NewProductionConfig()
		cfg.EncoderConfig.TimeKey = "ts"
		cfg.EncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder
		l, _ := cfg.Build()
		return l
	}
	l, _ := zap.NewDevelopment()
	return l
}
