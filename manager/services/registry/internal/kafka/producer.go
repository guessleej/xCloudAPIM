package kafka

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/segmentio/kafka-go"
	"github.com/xcloudapim/registry-service/internal/domain"
	"go.uber.org/zap"
)

type Producer struct {
	writers map[string]*kafka.Writer
	logger  *zap.Logger
}

func NewProducer(brokers []string, topics []string, logger *zap.Logger) *Producer {
	writers := make(map[string]*kafka.Writer, len(topics))
	for _, topic := range topics {
		writers[topic] = &kafka.Writer{
			Addr:         kafka.TCP(brokers...),
			Topic:        topic,
			Balancer:     &kafka.LeastBytes{},
			BatchTimeout: 10 * time.Millisecond,
			Async:        true, // 非同步，不阻塞 API 請求
			ErrorLogger:  kafka.LoggerFunc(func(msg string, a ...interface{}) {
				logger.Warn("kafka write error", zap.String("msg", fmt.Sprintf(msg, a...)))
			}),
		}
	}
	return &Producer{writers: writers, logger: logger}
}

// PublishAPIEvent 發布 API 事件至 Kafka
func (p *Producer) PublishAPIEvent(ctx context.Context, topic string, event *domain.APIEvent) error {
	w, ok := p.writers[topic]
	if !ok {
		return fmt.Errorf("unknown topic: %s", topic)
	}

	event.Timestamp = time.Now().UTC()
	payload, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}

	msg := kafka.Message{
		Key:   []byte(event.APIID),
		Value: payload,
		Headers: []kafka.Header{
			{Key: "event_type", Value: []byte(event.EventType)},
			{Key: "source",     Value: []byte("registry-service")},
		},
	}

	if err := w.WriteMessages(ctx, msg); err != nil {
		p.logger.Warn("publish api event failed",
			zap.String("topic", topic),
			zap.String("event_type", event.EventType),
			zap.Error(err),
		)
		return err
	}

	p.logger.Debug("api event published",
		zap.String("topic", topic),
		zap.String("event_type", event.EventType),
		zap.String("api_id", event.APIID),
	)
	return nil
}

func (p *Producer) Close() error {
	for _, w := range p.writers {
		if err := w.Close(); err != nil {
			p.logger.Warn("close kafka writer failed", zap.Error(err))
		}
	}
	return nil
}
