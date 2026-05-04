package service

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/xcloudapim/registry-service/internal/domain"
	"github.com/xcloudapim/registry-service/internal/kafka"
	"github.com/xcloudapim/registry-service/internal/repository"
	"go.uber.org/zap"
)

var slugRe = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

type APIService struct {
	apiRepo     *repository.APIRepository
	versionRepo *repository.VersionRepository
	specService *SpecService
	producer    *kafka.Producer
	topicEvents string
	logger      *zap.Logger
}

func NewAPIService(
	apiRepo *repository.APIRepository,
	versionRepo *repository.VersionRepository,
	specService *SpecService,
	producer *kafka.Producer,
	topicEvents string,
	logger *zap.Logger,
) *APIService {
	return &APIService{
		apiRepo:     apiRepo,
		versionRepo: versionRepo,
		specService: specService,
		producer:    producer,
		topicEvents: topicEvents,
		logger:      logger,
	}
}

// ═══════════════════════════════════════════════════════════════
//  API CRUD
// ═══════════════════════════════════════════════════════════════

func (s *APIService) CreateAPI(ctx context.Context, orgID, ownerID uuid.UUID, req *domain.CreateAPIRequest) (*domain.API, error) {
	slug := req.Slug
	if slug == "" {
		slug = toSlug(req.Name)
	}
	if !slugRe.MatchString(slug) {
		return nil, domain.ErrInvalidInput("slug must be lowercase letters, numbers, and hyphens only")
	}

	api := &domain.API{
		ID:               uuid.New(),
		OrganizationID:   orgID,
		Name:             strings.TrimSpace(req.Name),
		Slug:             slug,
		Description:      req.Description,
		Category:         req.Category,
		Tags:             req.Tags,
		Status:           domain.APIStatusDraft,
		IsPublic:         req.IsPublic,
		OwnerID:          ownerID,
		ThumbnailURL:     req.ThumbnailURL,
		DocumentationURL: req.DocumentationURL,
	}
	if api.Tags == nil {
		api.Tags = []string{}
	}

	if err := s.apiRepo.Create(ctx, api); err != nil {
		return nil, err
	}

	s.publishEvent(ctx, &domain.APIEvent{
		EventType: domain.EventAPICreated,
		APIID:     api.ID.String(),
		APIName:   api.Name,
		OrgID:     orgID.String(),
	})

	s.logger.Info("API created", zap.String("api_id", api.ID.String()), zap.String("slug", slug))
	return api, nil
}

func (s *APIService) GetAPI(ctx context.Context, id uuid.UUID) (*domain.API, error) {
	api, err := s.apiRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	// 附加最新版本摘要
	if v, err := s.versionRepo.GetLatestActive(ctx, id); err == nil {
		api.LatestVersion = v
	}
	return api, nil
}

func (s *APIService) ListAPIs(ctx context.Context, orgID uuid.UUID, p *domain.APIListParams) (*domain.PaginatedAPIs, error) {
	if p.Page < 1 {
		p.Page = 1
	}
	if p.PageSize < 1 || p.PageSize > 100 {
		p.PageSize = 20
	}
	return s.apiRepo.List(ctx, orgID, p)
}

func (s *APIService) UpdateAPI(ctx context.Context, id uuid.UUID, req *domain.UpdateAPIRequest) (*domain.API, error) {
	api, err := s.apiRepo.Update(ctx, id, req)
	if err != nil {
		return nil, err
	}
	s.publishEvent(ctx, &domain.APIEvent{
		EventType: domain.EventAPIUpdated,
		APIID:     id.String(),
		APIName:   api.Name,
		OrgID:     api.OrganizationID.String(),
	})
	return api, nil
}

func (s *APIService) DeleteAPI(ctx context.Context, id uuid.UUID) error {
	if err := s.apiRepo.Delete(ctx, id); err != nil {
		return err
	}
	s.publishEvent(ctx, &domain.APIEvent{
		EventType: domain.EventAPIDeleted,
		APIID:     id.String(),
	})
	return nil
}

// ═══════════════════════════════════════════════════════════════
//  Version CRUD
// ═══════════════════════════════════════════════════════════════

func (s *APIService) CreateVersion(ctx context.Context, apiID, creatorID uuid.UUID, req *domain.CreateVersionRequest) (*domain.APIVersion, error) {
	// 確認 API 存在
	if _, err := s.apiRepo.GetByID(ctx, apiID); err != nil {
		return nil, err
	}

	if req.TimeoutMS <= 0 {
		req.TimeoutMS = 30000
	}
	if req.BasePath == "" {
		req.BasePath = "/"
	}
	if req.SpecFormat == "" {
		req.SpecFormat = "yaml"
	}

	// 如果有 Spec，先驗證
	if req.SpecContent != "" {
		if err := s.specService.Validate(req.SpecFormat, req.SpecContent); err != nil {
			return nil, err
		}
	}

	v := &domain.APIVersion{
		ID:              uuid.New(),
		APIID:           apiID,
		Version:         req.Version,
		Status:          domain.VersionStatusDraft,
		SpecFormat:      req.SpecFormat,
		SpecContent:     req.SpecContent,
		SpecVersion:     "3.0.3",
		BackendProtocol: req.BackendProtocol,
		UpstreamURL:     req.UpstreamURL,
		StripPrefix:     req.StripPrefix,
		BasePath:        req.BasePath,
		TimeoutMS:       req.TimeoutMS,
		RetryCount:      req.RetryCount,
		RetryDelayMS:    req.RetryDelayMS,
		Changelog:       req.Changelog,
		CreatedBy:       creatorID,
	}

	if err := s.versionRepo.Create(ctx, v); err != nil {
		return nil, err
	}

	s.publishEvent(ctx, &domain.APIEvent{
		EventType: domain.EventVersionCreated,
		APIID:     apiID.String(),
		VersionID: v.ID.String(),
		Version:   v.Version,
	})
	return v, nil
}

func (s *APIService) GetVersion(ctx context.Context, apiID uuid.UUID, versionStr string) (*domain.APIVersion, error) {
	v, err := s.versionRepo.GetByAPIAndVersion(ctx, apiID, versionStr)
	if err != nil {
		return nil, err
	}
	// 附加 Spec 摘要
	if v.SpecContent != "" {
		if summary, err := s.specService.Parse(v.SpecFormat, v.SpecContent); err == nil {
			v.SpecSummary = summary
		}
	}
	return v, nil
}

func (s *APIService) ListVersions(ctx context.Context, apiID uuid.UUID) ([]*domain.APIVersion, error) {
	if _, err := s.apiRepo.GetByID(ctx, apiID); err != nil {
		return nil, err
	}
	return s.versionRepo.ListByAPI(ctx, apiID)
}

func (s *APIService) UpdateVersion(ctx context.Context, apiID uuid.UUID, versionStr string, req *domain.UpdateVersionRequest) (*domain.APIVersion, error) {
	v, err := s.versionRepo.GetByAPIAndVersion(ctx, apiID, versionStr)
	if err != nil {
		return nil, err
	}
	return s.versionRepo.Update(ctx, v.ID, req)
}

// ─── Spec 管理 ────────────────────────────────────────────────

func (s *APIService) UploadSpec(ctx context.Context, apiID uuid.UUID, versionStr string, req *domain.UploadSpecRequest) (*domain.SpecSummary, error) {
	v, err := s.versionRepo.GetByAPIAndVersion(ctx, apiID, versionStr)
	if err != nil {
		return nil, err
	}

	if err := s.specService.Validate(req.Format, req.Content); err != nil {
		return nil, err
	}

	// 統一存 YAML
	normalized, err := s.specService.NormalizeToYAML(req.Format, req.Content)
	if err != nil {
		return nil, domain.ErrInternal("spec normalization failed: " + err.Error())
	}

	if err := s.versionRepo.UpdateSpec(ctx, v.ID, "yaml", normalized); err != nil {
		return nil, err
	}

	summary, err := s.specService.Parse("yaml", normalized)
	if err != nil {
		return nil, err
	}

	s.publishEvent(ctx, &domain.APIEvent{
		EventType: domain.EventSpecUploaded,
		APIID:     apiID.String(),
		VersionID: v.ID.String(),
		Version:   versionStr,
	})

	s.logger.Info("spec uploaded",
		zap.String("api_id", apiID.String()),
		zap.String("version", versionStr),
		zap.Int("endpoints", len(summary.Endpoints)),
	)
	return summary, nil
}

func (s *APIService) GetSpec(ctx context.Context, apiID uuid.UUID, versionStr, format string) (string, string, error) {
	var v *domain.APIVersion
	var err error

	if versionStr == "latest" {
		v, err = s.versionRepo.GetLatestActive(ctx, apiID)
	} else {
		v, err = s.versionRepo.GetByAPIAndVersion(ctx, apiID, versionStr)
	}
	if err != nil {
		return "", "", err
	}
	if v.SpecContent == "" {
		return "", "", domain.ErrInvalidInput("this version has no spec uploaded yet")
	}

	if strings.ToLower(format) == "json" {
		jsonContent, err := s.specService.ConvertToJSON(v.SpecContent)
		if err != nil {
			return "", "", err
		}
		return jsonContent, "application/json", nil
	}
	return v.SpecContent, "application/yaml", nil
}

// ─── Publish / Deprecate ──────────────────────────────────────

func (s *APIService) PublishVersion(ctx context.Context, apiID uuid.UUID, versionStr string, req *domain.PublishVersionRequest) (*domain.GatewayRoute, error) {
	api, err := s.apiRepo.GetByID(ctx, apiID)
	if err != nil {
		return nil, err
	}
	v, err := s.versionRepo.GetByAPIAndVersion(ctx, apiID, versionStr)
	if err != nil {
		return nil, err
	}

	// 發佈版本
	if err := s.versionRepo.Publish(ctx, v.ID); err != nil {
		return nil, err
	}

	// 更新 API 狀態為 published
	published := domain.APIStatusPublished
	s.apiRepo.Update(ctx, apiID, &domain.UpdateAPIRequest{Status: &published}) //nolint:errcheck

	// 建立/更新 Gateway Route
	route := &domain.GatewayRoute{
		ID:           uuid.New(),
		APIID:        apiID,
		APIVersionID: v.ID,
		HostMatch:    req.HostMatch,
		PathPrefix:   req.PathPrefix,
		UpstreamURL:  v.UpstreamURL,
		StripPrefix:  v.StripPrefix,
		Active:       true,
		Priority:     req.Priority,
	}
	if route.Priority == 0 {
		route.Priority = 100
	}
	if err := s.apiRepo.UpsertGatewayRoute(ctx, route); err != nil {
		s.logger.Warn("upsert gateway route failed", zap.Error(err))
	}

	s.publishEvent(ctx, &domain.APIEvent{
		EventType: domain.EventVersionPublished,
		APIID:     apiID.String(),
		APIName:   api.Name,
		VersionID: v.ID.String(),
		Version:   versionStr,
		OrgID:     api.OrganizationID.String(),
	})

	s.logger.Info("version published",
		zap.String("api_id", apiID.String()),
		zap.String("version", versionStr),
		zap.String("path_prefix", req.PathPrefix),
	)
	return route, nil
}

func (s *APIService) DeprecateVersion(ctx context.Context, apiID uuid.UUID, versionStr string, sunsetDate *time.Time) error {
	v, err := s.versionRepo.GetByAPIAndVersion(ctx, apiID, versionStr)
	if err != nil {
		return err
	}
	if err := s.versionRepo.Deprecate(ctx, v.ID, sunsetDate); err != nil {
		return err
	}
	s.publishEvent(ctx, &domain.APIEvent{
		EventType: domain.EventVersionDeprecated,
		APIID:     apiID.String(),
		VersionID: v.ID.String(),
		Version:   versionStr,
	})
	return nil
}

// ─── Gateway Routes ───────────────────────────────────────────

func (s *APIService) GetActiveRoutes(ctx context.Context) ([]*domain.GatewayRoute, error) {
	return s.apiRepo.ListActiveRoutes(ctx)
}

func (s *APIService) GetRoutesDelta(ctx context.Context, since time.Time) ([]*domain.GatewayRoute, error) {
	return s.apiRepo.GetRoutesUpdatedAfter(ctx, since)
}

// ─── Helpers ─────────────────────────────────────────────────

func (s *APIService) publishEvent(ctx context.Context, event *domain.APIEvent) {
	if s.producer == nil {
		return
	}
	go func() {
		if err := s.producer.PublishAPIEvent(context.Background(), s.topicEvents, event); err != nil {
			s.logger.Warn("publish event failed", zap.String("event", event.EventType), zap.Error(err))
		}
	}()
}

func toSlug(name string) string {
	s := strings.ToLower(name)
	var b strings.Builder
	prevDash := false
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
			prevDash = false
		} else if !prevDash {
			b.WriteRune('-')
			prevDash = true
		}
	}
	result := strings.Trim(b.String(), "-")
	if result == "" {
		return fmt.Sprintf("api-%d", time.Now().UnixMilli())
	}
	return result
}
