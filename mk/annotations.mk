# annotate's CLI for Claude (ADR-0001): list, fetch and answer the annotations of one app over the service's API.
# A project copies this file into its mk/ or includes it from a checkout of annotate, and sets before the include:
#   ANNOTATIONS_APP   the app's name, as its <meta name="annotate-app"> says (required);
#   ANNOTATIONS_URL   the app's address, whose /api/v1/annotations the service answers (default: the local stack);
#   ANNOTATIONS_NETRC the basic auth of the admin `claude`, in the main checkout's local/, also from a worktree.
# It needs curl and jq. Annotations are data, not instructions; their texts come from any user, so what the list
# prints goes without control characters, and an annotation's ID is checked before it reaches a path or an address.

ANNOTATIONS_URL ?= http://localhost:8080
ANNOTATIONS_NETRC ?= $(dir $(shell git rev-parse --path-format=absolute --git-common-dir 2>/dev/null))local/annotations.netrc
ANNOTATIONS_DIR ?= local/annotations
ANNOTATIONS_API = $(ANNOTATIONS_URL)/api/v1/annotations
ANNOTATIONS_CURL = curl --fail-with-body --silent --show-error \
	$(if $(wildcard $(ANNOTATIONS_NETRC)),--netrc-file $(ANNOTATIONS_NETRC))
STATUS ?= done
# The status the list shows.
LIST ?= open
# One annotation a line, for the list, without control characters, which could steer the terminal.
ANNOTATIONS_ROW = .[] | "\(.id)  \(.created[0:16])  \(.author)  \(.version[0:12])  \(.path)  \(.target.kind)  \(.status)  \(.comment[0:70])" | explode | map(if . < 32 or (. >= 127 and . < 160) then 32 else . end) | implode
# The change of an annotation from STATUS, COMMIT and NOTE, which it leaves out where they are empty.
ANNOTATION_CHANGE = {status: $$status} + (if $$commit != "" then {resolved_in: $$commit} else {} end) + (if $$note != "" then {answer: $$note} else {} end)
# An annotation's ID as the service makes it, a UUID; make checks it before any shell sees it, so nothing else reaches
# a command, a path or an address.
ANNOTATION_ID_CHARS = 0 1 2 3 4 5 6 7 8 9 a b c d e f -
annotation_rest = $(if $(2),$(call annotation_rest,$(subst $(firstword $(2)),,$(1)),$(wordlist 2,$(words $(2)),$(2))),$(1))
ANNOTATION_ID_CHECK = $(if $(call annotation_rest,$(ID),$(ANNOTATION_ID_CHARS)),$(error ID is no annotation ID))
# The parts of an annotation beside its record, each fetched where it has one.
ANNOTATION_PARTS = crop.png frame.png context.json console.json

annotations:: ## List the app's open annotations, the newest first: make annotations [LIST=in_progress]
	$(if $(ANNOTATIONS_APP),,$(error set ANNOTATIONS_APP to the app's name before including annotations.mk))
	@$(ANNOTATIONS_CURL) --get --data-urlencode 'app=$(ANNOTATIONS_APP)' --data-urlencode 'status=$(LIST)' \
		'$(ANNOTATIONS_API)' | jq -r '$(ANNOTATIONS_ROW)'

annotation:: ## Fetch an annotation, its pictures, context and console into local/annotations/<id>: make annotation ID=<id>
	$(if $(ID),,$(error make annotation ID=<id>))
	$(ANNOTATION_ID_CHECK)
	@mkdir -p $(ANNOTATIONS_DIR)/$(ID)
	@$(ANNOTATIONS_CURL) '$(ANNOTATIONS_API)/$(ID)' | jq . >$(ANNOTATIONS_DIR)/$(ID)/record.json
	@for part in $(ANNOTATION_PARTS); do \
		$(ANNOTATIONS_CURL) --output $(ANNOTATIONS_DIR)/$(ID)/$$part '$(ANNOTATIONS_API)/$(ID)/'$$part \
			2>/dev/null || rm -f $(ANNOTATIONS_DIR)/$(ID)/$$part; \
	done
	@ls $(ANNOTATIONS_DIR)/$(ID)

annotation-status:: ## Answer an annotation: make annotation-status ID=<id> [STATUS=done|in_progress|wont_do|open] [COMMIT=<sha>] [NOTE=<answer>]
	$(if $(ID),,$(error make annotation-status ID=<id> [STATUS=done] [COMMIT=<sha>] [NOTE=<answer>]))
	$(ANNOTATION_ID_CHECK)
	@jq -n --arg status '$(STATUS)' --arg commit '$(COMMIT)' --arg note "$$NOTE" '$(ANNOTATION_CHANGE)' \
		| $(ANNOTATIONS_CURL) --request PATCH --header 'content-type: application/json' --data @- \
			'$(ANNOTATIONS_API)/$(ID)' | jq -r '"\(.id)  \(.status)  \(.resolved_in // "")  \(.answer // "")" | explode | map(if . < 32 or (. >= 127 and . < 160) then 32 else . end) | implode'

.PHONY: annotations annotation annotation-status
