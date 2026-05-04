package grpc

import (
	"context"
	"fmt"
	"net"
	"runtime/debug"
	"time"

	"go.uber.org/zap"
	googlegrpc "google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/reflection"
	"google.golang.org/grpc/status"

	"github.com/xcloudapim/subscription-service/internal/domain"
	"github.com/xcloudapim/subscription-service/internal/service"
)

// ─── gRPC Request / Response（對應 policy.proto） ─────────────

type GetClientQuotaRequest struct {
	ClientID string
	APIID    string
}

type IncrementUsageRequest struct {
	ClientID string
	APIID    string
	Count    int64
}

type UsageResult struct {
	CurrentCount int64
}

type CheckQuotaRequest struct {
	ClientID string
	APIID    string
}

// ─── Server ───────────────────────────────────────────────────

type Server struct {
	grpc         *googlegrpc.Server
	quotaSvc     *service.QuotaService
	log          *zap.Logger
	port         int
}

func NewServer(quotaSvc *service.QuotaService, log *zap.Logger, port int) *Server {
	srv := googlegrpc.NewServer(
		googlegrpc.ChainUnaryInterceptor(
			loggingInterceptor(log),
			recoveryInterceptor(log),
		),
		googlegrpc.KeepaliveParams(keepalive.ServerParameters{
			MaxConnectionIdle: 15 * time.Second,
			Time:              5 * time.Second,
			Timeout:           1 * time.Second,
		}),
	)
	reflection.Register(srv)

	return &Server{grpc: srv, quotaSvc: quotaSvc, log: log, port: port}
}

func (s *Server) Start() error {
	addr := fmt.Sprintf(":%d", s.port)
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("listen %s: %w", addr, err)
	}
	s.log.Info("subscription gRPC starting", zap.String("addr", addr))
	return s.grpc.Serve(lis)
}

func (s *Server) Stop() {
	s.grpc.GracefulStop()
}

// ─── gRPC Methods ─────────────────────────────────────────────

func (s *Server) GetClientQuota(ctx context.Context, req *GetClientQuotaRequest) (*domain.ClientQuota, error) {
	q, err := s.quotaSvc.GetClientQuota(ctx, req.ClientID, req.APIID)
	if err != nil {
		return nil, status.Errorf(codes.NotFound, "quota not found: %v", err)
	}
	return q, nil
}

func (s *Server) IncrementUsage(ctx context.Context, req *IncrementUsageRequest) (*UsageResult, error) {
	count := req.Count
	if count <= 0 {
		count = 1
	}
	current, err := s.quotaSvc.IncrementUsage(ctx, req.ClientID, req.APIID, count)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "increment usage: %v", err)
	}
	return &UsageResult{CurrentCount: current}, nil
}

func (s *Server) CheckQuota(ctx context.Context, req *CheckQuotaRequest) (*domain.QuotaCheckResult, error) {
	result, err := s.quotaSvc.CheckQuota(ctx, req.ClientID, req.APIID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "check quota: %v", err)
	}
	return result, nil
}

// ─── Interceptors ─────────────────────────────────────────────

func loggingInterceptor(log *zap.Logger) googlegrpc.UnaryServerInterceptor {
	return func(ctx context.Context, req interface{}, info *googlegrpc.UnaryServerInfo, handler googlegrpc.UnaryHandler) (interface{}, error) {
		start := time.Now()
		resp, err := handler(ctx, req)
		s, _ := status.FromError(err)
		log.Info("grpc", zap.String("method", info.FullMethod),
			zap.Duration("duration", time.Since(start)),
			zap.String("code", s.Code().String()))
		return resp, err
	}
}

func recoveryInterceptor(log *zap.Logger) googlegrpc.UnaryServerInterceptor {
	return func(ctx context.Context, req interface{}, info *googlegrpc.UnaryServerInfo, handler googlegrpc.UnaryHandler) (resp interface{}, err error) {
		defer func() {
			if r := recover(); r != nil {
				log.Error("panic", zap.Any("panic", r), zap.String("stack", string(debug.Stack())))
				err = status.Errorf(codes.Internal, "internal server error")
			}
		}()
		return handler(ctx, req)
	}
}
