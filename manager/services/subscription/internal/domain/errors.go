package domain

import "errors"

var (
	ErrNotFound           = errors.New("not found")
	ErrSubscriptionExists = errors.New("subscription already exists for this org and API")
	ErrInvalidStatus      = errors.New("invalid status transition")
	ErrPlanNotFound       = errors.New("plan not found")
	ErrAPIKeyNotFound     = errors.New("api key not found")
	ErrAPIKeyRevoked      = errors.New("api key has been revoked")
	ErrAPIKeyExpired      = errors.New("api key has expired")
	ErrQuotaExceeded      = errors.New("quota exceeded")
	ErrMaxKeysReached     = errors.New("maximum api keys limit reached for this plan")
	ErrUnauthorized       = errors.New("unauthorized")
	ErrSubscriptionNotActive = errors.New("subscription is not active")
)

// StatusTransitions 合法的訂閱狀態轉換
var StatusTransitions = map[SubscriptionStatus][]SubscriptionStatus{
	SubStatusPending:   {SubStatusActive, SubStatusCancelled},
	SubStatusActive:    {SubStatusSuspended, SubStatusCancelled, SubStatusExpired},
	SubStatusSuspended: {SubStatusActive, SubStatusCancelled},
	SubStatusExpired:   {SubStatusCancelled},
	SubStatusCancelled: {},
}

func CanTransition(from, to SubscriptionStatus) bool {
	allowed, ok := StatusTransitions[from]
	if !ok {
		return false
	}
	for _, s := range allowed {
		if s == to {
			return true
		}
	}
	return false
}
