#!/usr/bin/env bash
set -euo pipefail

failures=0
warnings=0
mise_path_warning=0

required_node="20.14.0"
required_go="1.22.5"

ok() {
  printf "ok  %-18s %s\n" "$1" "$2"
}

warn() {
  printf "warn %-17s %s\n" "$1" "$2"
  warnings=$((warnings + 1))
}

err() {
  printf "err %-18s %s\n" "$1" "$2"
  failures=$((failures + 1))
}

version_or_empty() {
  "$@" 2>/dev/null | head -n 1 || true
}

check_node() {
  if ! command -v node >/dev/null 2>&1; then
    err "node" "missing. Install Node ${required_node} via mise/asdf."
    return
  fi

  local actual
  actual="$(node -p 'process.versions.node')"
  if [ "$actual" = "$required_node" ]; then
    ok "node" "v${actual}"
  else
    warn "node" "found v${actual}; project expects v${required_node}. Run: mise install && mise exec -- node --version"
  fi
}

check_npm() {
  if command -v npm >/dev/null 2>&1; then
    ok "npm" "$(version_or_empty npm --version)"
  else
    err "npm" "missing. Node should provide npm."
  fi
}

check_go() {
  local go_cmd=()
  if command -v go >/dev/null 2>&1; then
    go_cmd=(go)
  elif command -v mise >/dev/null 2>&1 && mise which go >/dev/null 2>&1; then
    go_cmd=("$(mise which go)")
    warn "go path" "Go ${required_go} is installed by mise but shims are not active. Run: eval \"\$(mise activate zsh)\""
    mise_path_warning=1
  else
    err "go" "missing. Install Go ${required_go} with: make bootstrap-go"
    return
  fi

  local actual
  actual="$("${go_cmd[@]}" env GOVERSION 2>/dev/null | sed 's/^go//')"
  if [ "$actual" = "$required_go" ]; then
    ok "go" "go${actual}"
  else
    warn "go" "found go${actual}; project expects go${required_go}. Run: make bootstrap-go"
  fi
}

check_docker() {
  if command -v docker >/dev/null 2>&1; then
    ok "docker" "$(version_or_empty docker --version)"
  else
    err "docker" "missing. Install Docker Desktop / Docker Engine 26+."
    return
  fi

  if docker compose version >/dev/null 2>&1; then
    ok "docker compose" "$(docker compose version)"
  else
    err "docker compose" "missing. Install Docker Compose v2.24+."
  fi
}

check_node
check_npm
check_go
check_docker

for dir in gateway manager/bff portal studio manager/services/analytics manager/services/notification; do
  if [ -f "$dir/package.json" ] && [ ! -d "$dir/node_modules" ]; then
    warn "$dir" "run npm ci --prefix $dir"
  fi
done

if [ "$failures" -gt 0 ]; then
  printf "\n%d required tool(s) missing. Run make bootstrap-go for Go, or mise install/asdf install for the full toolchain.\n" "$failures"
  exit 1
fi

if [ "$warnings" -gt 0 ]; then
  printf "\nToolchain is usable, but %d version warning(s) should be fixed for reproducible local validation.\n" "$warnings"
  if [ "$mise_path_warning" -eq 1 ]; then
    printf '%s\n' 'For zsh, enable mise permanently with: echo '\''eval "$(mise activate zsh)"'\'' >> ~/.zshrc'
  fi
  exit 0
fi

printf "\nToolchain looks ready.\n"
