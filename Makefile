SHELL := bash
.SHELLFLAGS := -euo pipefail -c
.DEFAULT_GOAL := help

# Golden path project-base (EMIT ADR-0006), as tutti has it. The project's targets are in mk/project.mk. Targets use
# `::`, so every file can extend them; `sbom` and `dist` extend through their hooks.
PROJECT := annotate
VERSION := $(shell git describe --tags --always --dirty 2>/dev/null || echo 0.0.0)
SHELL_FILES = $(shell git ls-files '*.sh' '*.bash')

# SBOM (EMIT ADR-0005, sbom-generation). What ships is built in dist-build::, described in sbom-build:: and named in
# SBOM_DELIVERED; these must pass every required BSI TR-03183-2 field.
SBOM := build/sbom.cdx.json
SBOM_CREATOR := Andreas Hoch
SBOM_CONTACT := security@emit-gmbh.de
SBOM_DELIVERED ?=

# Quiet on success, full output on failure; V=1 shows everything.
ifeq ($(V),1)
run = $(2)
else
run = @log=$$(mktemp); if ! ( $(2) ) >"$$log" 2>&1; then echo "FAIL $(1)"; cat "$$log"; rm -f "$$log"; exit 1; fi; rm -f "$$log"
endif

help:: ## Show targets
	@grep -hE '^[a-z0-9-]+::?.*## ' $(MAKEFILE_LIST) | awk -F'::?.*## ' '!seen[$$1]++ {printf "  %-10s %s\n", $$1, $$2}'

setup:: ## Install the pinned tools
	$(call run,mise,mise install)

fmt:: ## Format all sources
	$(call run,shfmt,$(if $(SHELL_FILES),shfmt -w $(SHELL_FILES),true))

lint:: ## Check formatting, static analysis and secrets
	$(call run,shfmt,$(if $(SHELL_FILES),shfmt -d $(SHELL_FILES),true))
	$(call run,shellcheck,$(if $(SHELL_FILES),shellcheck $(SHELL_FILES),true))
	$(call run,gitleaks,gitleaks git --no-banner --redact .)

# syft leaves out the creator and does not link the root to the top-level components.
define SBOM_META
.metadata.manufacturer = {name: $$name, contact: [{email: $$email}]}
| .metadata.component.type = "application"
| .metadata.component["bom-ref"] as $$root
| ([.components[]?["bom-ref"]] - [.dependencies[]?.dependsOn[]?]) as $$top
| .dependencies = [{ref: $$root, dependsOn: ([.dependencies[]? | select(.ref == $$root) | .dependsOn[]?] + $$top | unique)}]
	+ [.dependencies[]? | select(.ref != $$root)]
| .compositions = [{aggregate: "unknown", dependencies: [.dependencies[].ref]}]
endef

# Fails with the missing fields of the SBOM itself and of SBOM_DELIVERED, and on SBOM_DELIVERED ids that match
# no component. Without components there is no dependency graph to rate.
define SBOM_GATE
(["SBOM"] + ($$ids | split(" ") | map(select(. != "")))) as $$strict
| [.sections[] | select(.required and .score < 10 and (.element_id as $$e | $$strict | index($$e)))
	| select($$components > 0 or .section_data_field != "dependency graph completeness")
	| "missing in \(.element_id): \(.section_data_field)"]
	+ ($$strict - [.sections[].element_id] | map("not in the SBOM: \(.)"))
| if length == 0 then true else join("\n") + "\n" | halt_error(1) end
endef
export SBOM_META SBOM_GATE

sbom-build::
	$(call run,syft,mkdir -p build && syft scan dir:. -q --select-catalogers -file --select-catalogers -github-actions \
		--exclude './build' --exclude './client/node_modules' --source-name $(PROJECT) --source-version $(VERSION) \
		--source-supplier '$(SBOM_CREATOR)' -o cyclonedx-json=build/sbom.raw.json)
	$(call run,sbom-meta,jq --arg name '$(SBOM_CREATOR)' --arg email '$(SBOM_CONTACT)' "$$SBOM_META" build/sbom.raw.json >$(SBOM))

sbom: sbom-build ## Write the CycloneDX SBOM to build/sbom.cdx.json and check it
	$(call run,cyclonedx,cyclonedx validate --input-file $(SBOM) --fail-on-errors)
	$(call run,sbomqs,sbomqs compliance --bsi-v21 --json $(SBOM) >build/sbom-bsi.json \
		&& jq -e --arg ids '$(SBOM_DELIVERED)' --argjson components "$$(jq '.components // [] | length' $(SBOM))" \
		"$$SBOM_GATE" build/sbom-bsi.json)

audit:: sbom ## Fail on known high or critical vulnerabilities
	$(call run,grype,grype sbom:$(SBOM) --by-cve --fail-on high)

dist-build::
	@mkdir -p build/dist

dist: dist-build sbom ## Write the release assets with their SBOM and checksums to build/dist/
	$(call run,dist,cp $(SBOM) build/dist/$(PROJECT)-$(VERSION).cdx.json \
		&& cd build/dist && rm -f SHA256SUMS && sha256sum -- * >SHA256SUMS)

ci:: lint audit ## Every check, before a pull request

clean:: ## Remove build output
	$(call run,clean,rm -rf build)

.PHONY: help setup fmt lint sbom-build sbom audit dist-build dist ci clean
include $(sort $(wildcard mk/*.mk))
