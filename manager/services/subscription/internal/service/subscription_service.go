package service

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/xcloudapim/subscription-service/internal/domain"
	"github.com/xcloudapim/subscription-service/internal/repository"
)

type SubscriptionService struct {
	subRepo  *repository.SubscriptionRepo
	planRepo *repository.PlanRepo
}

func NewSubscriptionService(
	subRepo *repository.SubscriptionRepo,
	planRepo *repository.PlanRepo,
) *SubscriptionService {
	return &SubscriptionService{subRepo: subRepo, planRepo: planRepo}
}

func (s *SubscriptionService) Create(ctx context.Context, orgID, subscriberID string, req *domain.CreateSubscriptionReq) (*domain.Subscription, error) {
	// 驗證 plan 存在
	plan, err := s.planRepo.GetByID(ctx, req.PlanID)
	if err != nil {
		return nil, domain.ErrPlanNotFound
	}
	_ = plan

	sub := &domain.Subscription{
		ID:             uuid.New().String(),
		OrganizationID: orgID,
		APIID:          req.APIID,
		PlanID:         req.PlanID,
		SubscriberID:   subscriberID,
		Status:         domain.SubStatusPending,
		StartDate:      time.Now(),
		Notes:          req.Notes,
	}

	if err := s.subRepo.Create(ctx, sub); err != nil {
		return nil, err
	}
	return sub, nil
}

func (s *SubscriptionService) GetByID(ctx context.Context, id string) (*domain.Subscription, error) {
	sub, err := s.subRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	// 關聯 Plan
	if plan, pErr := s.planRepo.GetByID(ctx, sub.PlanID); pErr == nil {
		sub.Plan = plan
	}
	return sub, nil
}

func (s *SubscriptionService) List(ctx context.Context, orgID string, q *domain.ListSubscriptionsQuery) ([]*domain.Subscription, int, error) {
	filter := repository.ListSubFilter{
		OrgID:  orgID,
		Status: q.Status,
		APIID:  q.APIID,
		Page:   q.Page,
		Size:   q.Size,
	}
	return s.subRepo.List(ctx, filter)
}

func (s *SubscriptionService) Approve(ctx context.Context, id, approverID string) error {
	sub, err := s.subRepo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if !domain.CanTransition(sub.Status, domain.SubStatusActive) {
		return domain.ErrInvalidStatus
	}
	return s.subRepo.UpdateStatus(ctx, id, domain.SubStatusActive, &approverID)
}

func (s *SubscriptionService) Suspend(ctx context.Context, id string) error {
	sub, err := s.subRepo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if !domain.CanTransition(sub.Status, domain.SubStatusSuspended) {
		return domain.ErrInvalidStatus
	}
	return s.subRepo.UpdateStatus(ctx, id, domain.SubStatusSuspended, nil)
}

func (s *SubscriptionService) Cancel(ctx context.Context, id string) error {
	sub, err := s.subRepo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if !domain.CanTransition(sub.Status, domain.SubStatusCancelled) {
		return domain.ErrInvalidStatus
	}
	return s.subRepo.UpdateStatus(ctx, id, domain.SubStatusCancelled, nil)
}

func (s *SubscriptionService) ChangePlan(ctx context.Context, id, planID string) error {
	if _, err := s.planRepo.GetByID(ctx, planID); err != nil {
		return domain.ErrPlanNotFound
	}
	return s.subRepo.ChangePlan(ctx, id, planID)
}

func (s *SubscriptionService) ListPlans(ctx context.Context) ([]*domain.Plan, error) {
	return s.planRepo.List(ctx, true)
}

func (s *SubscriptionService) GetPlan(ctx context.Context, id string) (*domain.Plan, error) {
	return s.planRepo.GetByID(ctx, id)
}
