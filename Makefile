SHELL := bash
.SHELLFLAGS := -euo pipefail -c
.DEFAULT_GOAL := help

# The Rust build goes to build/target, where the image takes the service's binary from (image/Dockerfile).
export CARGO_TARGET_DIR := $(CURDIR)/build/target
CLIENT := client
PNPM := pnpm --dir $(CLIENT)
SHELL_FILES = $(shell git ls-files '*.sh')

# Quiet on success, full output on failure; V=1 shows everything.
ifeq ($(V),1)
run = $(2)
else
run = @log=$$(mktemp); if ! ( $(2) ) >"$$log" 2>&1; then echo "FAIL $(1)"; cat "$$log"; rm -f "$$log"; exit 1; fi; rm -f "$$log"
endif

help: ## Show targets
	@grep -hE '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '!seen[$$1]++ {printf "  %-18s %s\n", $$1, $$2}'

setup: ## Install the pinned tools and the client's packages
	$(call run,mise,mise install)
	$(call run,pnpm,$(PNPM) install --frozen-lockfile)

fmt: ## Format all sources
	$(call run,rustfmt,cargo fmt --all)
	$(call run,prettier,$(PNPM) run fmt)

lint: ## Check formatting, static analysis, types and dependencies
	$(call run,rustfmt,cargo fmt --all --check)
	$(call run,clippy,cargo clippy --workspace --all-targets --locked -- -D warnings)
	$(call run,cargo-deny,cargo deny check)
	$(call run,tsc,$(PNPM) run check)
	$(call run,eslint,$(PNPM) run lint)
	$(call run,bash,$(if $(SHELL_FILES),bash -n $(SHELL_FILES),true))

test: ## Run the unit and integration tests: the model, the service and its OpenAPI document, the client and the CLI
	$(call run,cargo-test,cargo test --workspace --locked)
	$(call run,vitest,$(PNPM) run test)
	$(call run,cli,cargo build --locked -p annotations-server && scripts/test-cli.sh)

build: ## Build the service's release binary and the client's bundles
	$(call run,cargo-build,cargo build --release --locked -p annotations-server)
	$(call run,client,$(PNPM) run build)

e2e: ## Run the client's end-to-end tests in Chromium against the demo pages, under a strict CSP
	$(call run,client,$(PNPM) run build)
	$(call run,playwright,$(PNPM) run e2e)

verify: lint test ## The checks before a commit

ci: verify build e2e ## Every check, before a pull request

openapi: ## Write openapi.json anew from the service's code
	$(call run,openapi,UPDATE_OPENAPI=1 cargo test --locked -p annotations-server --test openapi)

image: build ## Build the service's image (needs Docker): annotate-server:local
	docker build -f image/Dockerfile -t annotate-server:local \
		--build-arg VERSION=$$(git describe --tags --always) --build-arg REVISION=$$(git rev-parse HEAD) .

clean: ## Remove build output
	$(call run,clean,rm -rf build $(CLIENT)/dist)

.PHONY: help setup fmt lint test build e2e verify ci openapi image clean
