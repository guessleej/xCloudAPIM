package grpc

import (
	"fmt"
	"net"
	"time"

	"go.uber.org/zap"
	googlegrpc "google.golang.org/grpc"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/reflection"
)

// Server gRPC 伺服器包裝
type Server struct {
	grpc    *googlegrpc.Server
	handler *Handler
	log     *zap.Logger
	port    int
}

func NewServer(handler *Handler, log *zap.Logger, port int) *Server {
	srv := googlegrpc.NewServer(
		googlegrpc.ChainUnaryInterceptor(
			loggingInterceptor(log),
			recoveryInterceptor(log),
		),
		googlegrpc.KeepaliveParams(keepalive.ServerParameters{
			MaxConnectionIdle:     15 * time.Second,
			MaxConnectionAge:      30 * time.Second,
			MaxConnectionAgeGrace: 5 * time.Second,
			Time:                  5 * time.Second,
			Timeout:               1 * time.Second,
		}),
		googlegrpc.KeepaliveEnforcementPolicy(keepalive.EnforcementPolicy{
			MinTime:             5 * time.Second,
			PermitWithoutStream: true,
		}),
	)

	// 啟用 gRPC 反射（供 grpcurl 等工具使用）
	reflection.Register(srv)

	return &Server{grpc: srv, handler: handler, log: log, port: port}
}

func (s *Server) Start() error {
	addr := fmt.Sprintf(":%d", s.port)
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("listen %s: %w", addr, err)
	}
	s.log.Info("gRPC server starting", zap.String("addr", addr))
	return s.grpc.Serve(lis)
}

func (s *Server) Stop() {
	s.log.Info("gRPC server graceful stop")
	s.grpc.GracefulStop()
}

func (s *Server) GRPCServer() *googlegrpc.Server {
	return s.grpc
}
