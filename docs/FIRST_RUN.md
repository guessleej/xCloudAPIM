# First Run

This is the shortest local path from a clean clone to a usable xCloudAPIM portal.

## 1. Bootstrap Toolchain

```bash
mise install
eval "$(mise activate zsh)" # or add this line to ~/.zshrc
make doctor
```

If you use `asdf`, run `asdf install` instead of `mise install`.

## 2. Create Local Environment

```bash
cp .env.example .env
```

The development example intentionally uses local-only placeholder secrets. For production, provide real secrets through your deployment secret manager instead of committing `.env`.

## 3. Start Infrastructure And Migrate

```bash
make infra-up
make migrate
make seed
make vault-init
```

`make seed` creates a deterministic local user, organization, API, route, subscription, and API key.

Local portal account:

```text
URL:      http://localhost:19000
Email:    codex-dev@apim.local
Password: P@ssword123!
API key:  xcapim_dev_key_1234567890
```

## 4. Rebuild And Start Services

```bash
make up-build
make status
```

Important local endpoints:

```text
Portal:      http://localhost:19000
BFF:         http://localhost:14000/graphql
Gateway:     http://localhost:18090
Auth:        http://localhost:18091/healthz
Registry:    http://localhost:18082/healthz
```

## 5. Verify Core Flows

```bash
make test-e2e
make load-test
```

If `make test-e2e` fails on route sync, rerun `make seed` and restart the gateway so it performs a fresh full route sync.
