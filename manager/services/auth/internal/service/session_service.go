package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/xcloudapim/auth-service/internal/domain"
	"github.com/xcloudapim/auth-service/internal/repository"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
)

const sessionTokenTTL = time.Hour

type sessionClaims struct {
	jwt.RegisteredClaims
	UserID string `json:"uid"`
	Email  string `json:"email"`
}

type SessionService struct {
	userRepo      *repository.UserRepository
	sessionSecret []byte
	logger        *zap.Logger
}

func NewSessionService(userRepo *repository.UserRepository, sessionSecret string, logger *zap.Logger) *SessionService {
	return &SessionService{
		userRepo:      userRepo,
		sessionSecret: []byte(sessionSecret),
		logger:        logger,
	}
}

// Login 驗證帳密，回傳短效期 session JWT（1h）
func (s *SessionService) Login(ctx context.Context, email, password string) (string, *domain.User, error) {
	if email == "" || password == "" {
		return "", nil, errors.New("email and password are required")
	}

	user, err := s.userRepo.GetByEmail(ctx, email)
	if err != nil {
		return "", nil, fmt.Errorf("lookup user: %w", err)
	}
	if user == nil || !user.Active {
		return "", nil, errors.New("invalid credentials")
	}
	if user.PasswordHash == "" {
		return "", nil, errors.New("password login not available for this account")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return "", nil, errors.New("invalid credentials")
	}

	now := time.Now()
	claims := sessionClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "auth-service-session",
			Subject:   user.ID.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(sessionTokenTTL)),
		},
		UserID: user.ID.String(),
		Email:  user.Email,
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(s.sessionSecret)
	if err != nil {
		return "", nil, fmt.Errorf("sign session token: %w", err)
	}

	s.logger.Info("user login success", zap.String("user_id", user.ID.String()), zap.String("email", user.Email))
	return signed, user, nil
}

// VerifySessionToken 驗證並解析 session JWT，回傳 user_id
func (s *SessionService) VerifySessionToken(tokenStr string) (uuid.UUID, error) {
	claims := &sessionClaims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return s.sessionSecret, nil
	}, jwt.WithIssuer("auth-service-session"), jwt.WithExpirationRequired())

	if err != nil || !token.Valid {
		return uuid.Nil, errors.New("invalid or expired session token")
	}

	userID, err := uuid.Parse(claims.UserID)
	if err != nil {
		return uuid.Nil, errors.New("malformed user_id in session token")
	}
	return userID, nil
}
