#!/usr/bin/env bash
set -euo pipefail

services=(
  "manager/services/auth"
  "manager/services/registry"
  "manager/services/subscription"
  "policy-engine"
)

export GOCACHE="${GOCACHE:-$PWD/.cache/go-build}"
export GOMODCACHE="${GOMODCACHE:-$PWD/.cache/go-mod}"
mkdir -p "$GOCACHE" "$GOMODCACHE"

if [ "$(uname -s)" = "Darwin" ] && [ -z "${CGO_ENABLED:-}" ]; then
  # Go 1.22 test binaries can trip newer macOS dyld LC_UUID checks when cgo is on.
  export CGO_ENABLED=0
fi

go_test_flags=()
if [ "${GO_TEST_RACE:-0}" = "1" ]; then
  go_test_flags+=("-race")
fi
if [ -n "${GO_TEST_FLAGS:-}" ]; then
  # shellcheck disable=SC2206
  go_test_flags+=(${GO_TEST_FLAGS})
fi

run_go_test() {
  if [ "${#go_test_flags[@]}" -gt 0 ]; then
    "$@" test "${go_test_flags[@]}" ./...
  else
    "$@" test ./...
  fi
}

go_cmd=()
if command -v go >/dev/null 2>&1; then
  go_cmd=(go)
elif command -v mise >/dev/null 2>&1 && mise which go >/dev/null 2>&1; then
  go_cmd=("$(mise which go)")
fi

if [ "${#go_cmd[@]}" -gt 0 ]; then
  for svc in "${services[@]}"; do
    printf "  -> %s\n" "$svc"
    (cd "$svc" && run_go_test "${go_cmd[@]}")
  done
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "go is missing and docker is unavailable. Run make bootstrap-go or install Go 1.22.5." >&2
  exit 1
fi

echo "go is missing locally; running Go tests through Docker golang:1.22.5." >&2
for svc in "${services[@]}"; do
  printf "  -> %s\n" "$svc"
  if [ "${#go_test_flags[@]}" -gt 0 ]; then
    docker run --rm \
      -v "$PWD":/workspace \
      -w "/workspace/$svc" \
      golang:1.22.5 \
      go test "${go_test_flags[@]}" ./...
  else
    docker run --rm \
      -v "$PWD":/workspace \
      -w "/workspace/$svc" \
      golang:1.22.5 \
      go test ./...
  fi
done
