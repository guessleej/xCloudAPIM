// MongoDB 初始化腳本
// 建立 Collections、Indexes 與 TTL

db = db.getSiblingDB('apim_analytics');

// ─── API Request Logs ──────────────────────────────────────────
db.createCollection('api_request_logs', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['trace_id', 'client_id', 'api_id', 'method', 'path', 'status_code', 'latency_ms', 'timestamp'],
      properties: {
        trace_id:      { bsonType: 'string' },
        client_id:     { bsonType: 'string' },
        api_id:        { bsonType: 'string' },
        method:        { bsonType: 'string', enum: ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'] },
        path:          { bsonType: 'string' },
        status_code:   { bsonType: 'int', minimum: 100, maximum: 599 },
        latency_ms:    { bsonType: 'number', minimum: 0 },
        timestamp:     { bsonType: 'date' },
      }
    }
  }
});

// Indexes for api_request_logs
db.api_request_logs.createIndex({ timestamp: -1 });
db.api_request_logs.createIndex({ client_id: 1, timestamp: -1 });
db.api_request_logs.createIndex({ api_id: 1, timestamp: -1 });
db.api_request_logs.createIndex({ status_code: 1, timestamp: -1 });
db.api_request_logs.createIndex({ trace_id: 1 }, { unique: true, sparse: true });
// TTL: 90 天自動清除
db.api_request_logs.createIndex(
  { timestamp: 1 },
  { expireAfterSeconds: 90 * 24 * 3600, name: 'ttl_90d' }
);

// ─── Analytics Aggregations（每分鐘彙總） ─────────────────────
db.createCollection('analytics_minutely');
db.analytics_minutely.createIndex({ api_id: 1, minute: -1 });
db.analytics_minutely.createIndex({ client_id: 1, minute: -1 });
db.analytics_minutely.createIndex(
  { minute: 1 },
  { expireAfterSeconds: 7 * 24 * 3600, name: 'ttl_7d' }
);

// ─── Analytics Aggregations（每小時彙總） ─────────────────────
db.createCollection('analytics_hourly');
db.analytics_hourly.createIndex({ api_id: 1, hour: -1 });
db.analytics_hourly.createIndex(
  { hour: 1 },
  { expireAfterSeconds: 30 * 24 * 3600, name: 'ttl_30d' }
);

// ─── Error Events ─────────────────────────────────────────────
db.createCollection('error_events');
db.error_events.createIndex({ api_id: 1, timestamp: -1 });
db.error_events.createIndex({ client_id: 1, timestamp: -1 });
db.error_events.createIndex({ error_code: 1 });
db.error_events.createIndex(
  { timestamp: 1 },
  { expireAfterSeconds: 30 * 24 * 3600, name: 'ttl_30d' }
);

// ─── Quota Exceeded Events ────────────────────────────────────
db.createCollection('quota_events');
db.quota_events.createIndex({ client_id: 1, timestamp: -1 });
db.quota_events.createIndex({ api_id: 1, timestamp: -1 });

print('✅ MongoDB apim_analytics 初始化完成');
