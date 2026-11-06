# annotate's own targets (ADR-0001): the Rust service, the TypeScript client, the CLI's test and the service's image.

CLIENT := client
PNPM := pnpm --dir $(CLIENT)
SERVER := annotations-server

setup:: ## … and the client's packages and Playwright's Chromium
	$(call run,pnpm,$(PNPM) install --frozen-lockfile)
	$(call run,chromium,$(PNPM) exec playwright install chromium)

fmt::
	$(call run,rustfmt,cargo fmt --all)
	$(call run,prettier,$(PNPM) run fmt)

lint::
	$(call run,rustfmt,cargo fmt --all --check)
	$(call run,clippy,cargo clippy --workspace --all-targets --locked -- -D warnings)
	$(call run,cargo-deny,cargo deny check)
	$(call run,tsc,$(PNPM) run check)
	$(call run,eslint,$(PNPM) run lint)

test:: ## Run the unit and integration tests: the model, the service and its OpenAPI document, the client and the CLI
	$(call run,cargo-test,cargo test --workspace --locked)
	$(call run,vitest,$(PNPM) run test)
	$(call run,cli,cargo build --locked -p $(SERVER) && scripts/test-cli.sh)

server: ## Build the service's release binary into build/target/release
	$(call run,cargo-build,cargo build --release --locked -p $(SERVER))

client: ## Build the client's bundles and types into client/dist
	$(call run,client,$(PNPM) run build)

build:: server client ## Build the service and the client

e2e:: client ## Run the client's end-to-end tests in Chromium against the demo pages, under a strict CSP
	$(call run,playwright,$(PNPM) run e2e)

audit:: ## … and known vulnerabilities of the crates and the client's packages
	$(call run,cargo-advisories,cargo deny check advisories)
	$(call run,pnpm-audit,$(PNPM) audit)

verify: lint test ## The checks before a commit

ci:: verify e2e

openapi: ## Write openapi.json anew from the service's code
	$(call run,openapi,UPDATE_OPENAPI=1 cargo test --locked -p $(SERVER) --test openapi)

image: server ## Build the service's image (needs Docker): annotate-server:local
	docker build -f image/Dockerfile -t annotate-server:local \
		--build-arg VERSION=$(VERSION) --build-arg REVISION=$$(git rev-parse HEAD) .

clean::
	$(call run,client,rm -rf $(CLIENT)/dist)

.PHONY: test server client build e2e verify openapi image
