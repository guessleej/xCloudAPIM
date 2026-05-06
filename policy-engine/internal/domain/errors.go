package domain

import "errors"

var (
	ErrChainNotFound    = errors.New("policy chain not found")
	ErrPolicyNotFound   = errors.New("policy not found")
	ErrChainNotDraft    = errors.New("only draft chains can be modified")
	ErrChainAlreadyPublished = errors.New("chain is already published")
	ErrAPINotFound      = errors.New("api not found")
	ErrInvalidType      = errors.New("invalid policy type")
	ErrInvalidPhase     = errors.New("invalid policy phase")
)
