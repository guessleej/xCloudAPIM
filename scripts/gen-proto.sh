#!/usr/bin/env bash
# ─── Protobuf 程式碼產生腳本 ──────────────────────────────────
set -euo pipefail

PROTO_DIR="packages/shared/proto"
GO_OUT_DIR="packages/shared/generated/go"
TS_OUT_DIR="packages/shared/generated/ts"

mkdir -p "$GO_OUT_DIR" "$TS_OUT_DIR"

echo "▶ 產生 Go gRPC 程式碼..."
protoc \
  --go_out="$GO_OUT_DIR" --go_opt=paths=source_relative \
  --go-grpc_out="$GO_OUT_DIR" --go-grpc_opt=paths=source_relative \
  -I "$PROTO_DIR" \
  "$PROTO_DIR"/*.proto
echo "  ✅ Go 程式碼產生至 $GO_OUT_DIR"

echo "▶ 產生 TypeScript gRPC-Web 程式碼..."
protoc \
  --plugin="protoc-gen-ts=$(which protoc-gen-ts 2>/dev/null || echo 'protoc-gen-ts')" \
  --ts_out="$TS_OUT_DIR" \
  --ts_opt=esModuleInterop=true \
  -I "$PROTO_DIR" \
  "$PROTO_DIR"/*.proto 2>/dev/null || echo "  ⚠️  protoc-gen-ts 未安裝，跳過 TS 產生"

echo "✅ Protobuf 產生完成"
