# Toolchain

Use `mise` or `asdf` from the repository root:

```bash
mise install
# or
asdf install
```

Required local tools:

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 20.14.0 | Matches Dockerfiles for Gateway, BFF, Portal, and Studio |
| npm | bundled with Node 20 | Run per-service `npm ci` before local typecheck/test |
| TypeScript CLI | package-local | Use `npm run typecheck`; do not rely on a global `tsc` |
| Go | 1.22.5 | Required for auth, registry, and subscription local tests |
| Docker Desktop / Engine | 26+ | Required for compose, local smoke checks, and K6 |
| Docker Compose | v2.24+ | Use `docker compose`, not legacy `docker-compose` |

Local bootstrap:

```bash
mise install
eval "$(mise activate zsh)" # or add this line to ~/.zshrc
make doctor
cp .env.example .env
npm ci --prefix gateway
npm ci --prefix manager/bff
npm ci --prefix portal
npm ci --prefix studio
make status
```

If Go is not on `PATH` but was installed by `mise`, repo scripts use `mise exec -- go` automatically. To make `go` available in every new shell, add `eval "$(mise activate zsh)"` to `~/.zshrc`.

Local Go tests run without `-race` by default because older Go 1.22 race binaries can fail on newer macOS dyld checks. Use `GO_TEST_RACE=1 make test-go` when the local runtime supports it; CI still runs race tests on Linux.

For the full first-run sequence, including migrations, seed data, account creation, and service rebuilds, see `docs/FIRST_RUN.md`.
