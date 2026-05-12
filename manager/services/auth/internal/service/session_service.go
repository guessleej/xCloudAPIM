package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/xcloudapim/auth-service/internal/cache"
	"github.com/xcloudapim/auth-service/internal/domain"
	"github.com/xcloudapim/auth-service/internal/repository"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
)

const sessionTokenTTL = time.Hour

var ErrEmailAlreadyRegistered = errors.New("email already registered")

type sessionClaims struct {
	jwt.RegisteredClaims
	UserID      string `json:"uid"`
	Email       string `json:"email"`
	DisplayName string `json:"name"`
	Role        string `json:"role"`
	OrgID       string `json:"org_id,omitempty"`
	OrgName     string `json:"org_name,omitempty"`
}

type SessionIdentity struct {
	UserID      uuid.UUID
	Email       string
	DisplayName string
	Role        string
	OrgID       *uuid.UUID
	OrgName     string
}

type SessionService struct {
	userRepo      *repository.UserRepository
	redisCache    *cache.RedisCache
	sessionSecret []byte
	logger        *zap.Logger
}

func NewSessionService(userRepo *repository.UserRepository, redisCache *cache.RedisCache, sessionSecret string, logger *zap.Logger) *SessionService {
	return &SessionService{
		userRepo:      userRepo,
		redisCache:    redisCache,
		sessionSecret: []byte(sessionSecret),
		logger:        logger,
	}
}

func tokenHash(tokenStr string) string {
	h := sha256.Sum256([]byte(tokenStr))
	return hex.EncodeToString(h[:])
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
		UserID:      user.ID.String(),
		Email:       user.Email,
		DisplayName: user.DisplayName,
		Role:        user.Role,
		OrgName:     user.OrgName,
	}
	if user.OrgID != nil {
		claims.OrgID = user.OrgID.String()
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(s.sessionSecret)
	if err != nil {
		return "", nil, fmt.Errorf("sign session token: %w", err)
	}

	s.logger.Info("user login success", zap.String("user_id", user.ID.String()), zap.String("email", user.Email))
	return signed, user, nil
}

func (s *SessionService) Register(
	ctx context.Context,
	displayName string,
	email string,
	password string,
	orgName string,
) (string, *domain.User, error) {
	user, err := s.userRepo.CreateWithOrganization(ctx, email, displayName, password, orgName)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key value") || strings.Contains(err.Error(), "users_email_key") {
			return "", nil, ErrEmailAlreadyRegistered
		}
		return "", nil, fmt.Errorf("create user: %w", err)
	}

	now := time.Now()
	claims := sessionClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "auth-service-session",
			Subject:   user.ID.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(sessionTokenTTL)),
		},
		UserID:      user.ID.String(),
		Email:       user.Email,
		DisplayName: user.DisplayName,
		Role:        user.Role,
		OrgName:     user.OrgName,
	}
	if user.OrgID != nil {
		claims.OrgID = user.OrgID.String()
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(s.sessionSecret)
	if err != nil {
		return "", nil, fmt.Errorf("sign session token: %w", err)
	}

	s.logger.Info("user register success", zap.String("user_id", user.ID.String()), zap.String("email", user.Email))
	return signed, user, nil
}

// VerifySessionToken 驗證並解析 session JWT，回傳身份資訊
// 同時檢查 Redis blacklist，確保已登出 token 無法重複使用
func (s *SessionService) VerifySessionToken(tokenStr string) (*SessionIdentity, error) {
	// 先查黑名單（fast-path，避免解析開銷）
	hash := tokenHash(tokenStr)
	if s.redisCache != nil {
		revoked, err := s.redisCache.IsRevoked(context.Background(), hash)
		if err != nil {
			s.logger.Warn("blacklist check error, allowing request", zap.Error(err))
		} else if revoked {
			return nil, errors.New("session token has been revoked")
		}
	}

	claims := &sessionClaims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return s.sessionSecret, nil
	}, jwt.WithIssuer("auth-service-session"), jwt.WithExpirationRequired())

	if err != nil || !token.Valid {
		return nil, errors.New("invalid or expired session token")
	}

	userID, err := uuid.Parse(claims.UserID)
	if err != nil {
		return nil, errors.New("malformed user_id in session token")
	}

	var orgID *uuid.UUID
	if claims.OrgID != "" {
		parsedOrgID, parseErr := uuid.Parse(claims.OrgID)
		if parseErr != nil {
			return nil, errors.New("malformed org_id in session token")
		}
		orgID = &parsedOrgID
	}

	return &SessionIdentity{
		UserID:      userID,
		Email:       claims.Email,
		DisplayName: claims.DisplayName,
		Role:        claims.Role,
		OrgID:       orgID,
		OrgName:     claims.OrgName,
	}, nil
}

// RevokeSessionToken 將 session token 加入 Redis 黑名單直到過期
func (s *SessionService) RevokeSessionToken(ctx context.Context, tokenStr string) error {
	if s.redisCache == nil {
		return nil
	}
	// 先解析取得到期時間，計算剩餘 TTL
	claims := &sessionClaims{}
	_, _ = jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
		return s.sessionSecret, nil
	})

	var ttl time.Duration
	if claims.ExpiresAt != nil && claims.ExpiresAt.Time.After(time.Now()) {
		ttl = time.Until(claims.ExpiresAt.Time)
	} else {
		ttl = sessionTokenTTL
	}

	hash := tokenHash(tokenStr)
	if err := s.redisCache.RevokeToken(ctx, hash, ttl); err != nil {
		return fmt.Errorf("revoke session token: %w", err)
	}
	s.logger.Info("session token revoked", zap.String("hash", hash[:8]+"..."))
	return nil
}
