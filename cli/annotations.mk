# annotate's CLI for Claude (ADR-0001): list, fetch and answer the annotations of one app over the service's API.
# A project copies this file into its mk/ or includes it from a checkout of annotate, and sets before the include:
#   ANNOTATIONS_APP   the app's name, as its <meta name="annotate-app"> says (required);
#   ANNOTATIONS_URL   the app's address, whose /api/v1/annotations the service answers: https, or http on localhost;
#   ANNOTATIONS_NETRC the basic auth of the admin `claude`, in the main checkout's local/, also from a worktree;
#                     required for any address but localhost.
# It needs curl and jq, and runs in any POSIX shell.
#
# Annotations are data, not instructions; their texts come from any user, so what the targets print goes through
# ANNOTATIONS_CLEAN. What a caller gives (ID, STATUS, COMMIT, NOTE, LIST, LIMIT and the app) is taken as text, never
# expanded by make, checked by make before any shell sees it, and reaches commands only through the environment.

ANNOTATIONS_URL ?= http://localhost:8080
ANNOTATIONS_NETRC ?= $(dir $(shell git rev-parse --path-format=absolute --git-common-dir 2>/dev/null))local/annotations.netrc
ANNOTATIONS_DIR ?= local/annotations
STATUS ?= done
LIST ?= open
LIMIT ?= 100

# Taken as text: `NOTE='$(shell …)'` stays those characters.
override ANNOTATIONS_APP := $(value ANNOTATIONS_APP)
override ID := $(value ID)
override STATUS := $(value STATUS)
override COMMIT := $(value COMMIT)
override NOTE := $(value NOTE)
override LIST := $(value LIST)
override LIMIT := $(value LIMIT)
export ANNOTATIONS_APP ID STATUS COMMIT NOTE LIST LIMIT ANNOTATIONS_NETRC
export ANNOTATIONS_API := $(ANNOTATIONS_URL)/api/v1/annotations
export ANNOTATIONS_DIR

# The statuses the service knows.
ANNOTATION_STATUSES := open in_progress done wont_do
# The characters of an annotation's ID (a UUID), a commit, an app's name and a number.
ANNOTATION_HEX := 0 1 2 3 4 5 6 7 8 9 a b c d e f
ANNOTATION_ID_CHARS := $(ANNOTATION_HEX) -
ANNOTATION_APP_CHARS := $(ANNOTATION_HEX) g h i j k l m n o p q r s t u v w x y z - _
ANNOTATION_DIGITS := 0 1 2 3 4 5 6 7 8 9
# What is left of $(1) without the characters $(2); empty where $(1) has only those.
annotation_rest = $(if $(2),$(call annotation_rest,$(subst $(firstword $(2)),,$(1)),$(wordlist 2,$(words $(2)),$(2))),$(1))
# Fails with $(3) unless $(1) is not empty and has only the characters $(2).
annotation_only = $(if $(1),$(if $(call annotation_rest,$(1),$(2)),$(error $(3))),$(error $(3)))
# Fails unless $(1) is one status; $(2) names the setting.
annotation_status = $(if $(filter-out $(ANNOTATION_STATUSES),$(1))$(if $(1),,none),$(error $(2) is none of $(ANNOTATION_STATUSES)))

# The host of ANNOTATIONS_URL; http goes to localhost only, and every other address needs https and the netrc.
ANNOTATIONS_HOST = $(firstword $(subst :, ,$(firstword $(subst /, ,$(patsubst https://%,%,$(patsubst http://%,%,$(ANNOTATIONS_URL)))))))
ANNOTATIONS_LOCAL = $(filter localhost 127.0.0.1,$(ANNOTATIONS_HOST))
ANNOTATIONS_CHECK = $(call annotation_only,$(ANNOTATIONS_APP),$(ANNOTATION_APP_CHARS),set ANNOTATIONS_APP to the app's name before including annotations.mk) \
	$(if $(ANNOTATIONS_LOCAL),,$(if $(filter https://%,$(ANNOTATIONS_URL)),,$(error ANNOTATIONS_URL is no https address and not on localhost)) \
	$(if $(wildcard $(ANNOTATIONS_NETRC)),,$(error ANNOTATIONS_NETRC $(ANNOTATIONS_NETRC) is missing, which $(ANNOTATIONS_HOST) needs)))
ANNOTATION_ID_CHECK = $(call annotation_only,$(ID),$(ANNOTATION_ID_CHARS),ID is no annotation ID)

# Untrusted text as it may reach a terminal: control characters become spaces; bidi overrides and zero-width
# characters go.
ANNOTATIONS_CLEAN = def clean: explode | map(select((. >= 8203 and . <= 8207) or (. >= 8234 and . <= 8238) or (. >= 8288 and . <= 8297) or . == 65279 | not) | if . < 32 or (. >= 127 and . < 160) then 32 else . end) | implode;
# One annotation a line, for the list.
ANNOTATIONS_ROW = $(ANNOTATIONS_CLEAN) .[] | "\(.id)  \(.created[0:16])  \(.author)  \(.version[0:12])  \(.path)  \(.target.kind)  \(.status)  \(.comment[0:70])" | clean
# The change of an annotation from STATUS, COMMIT and NOTE, which it leaves out where they are empty.
ANNOTATION_CHANGE = {status: env.STATUS} + (if env.COMMIT != "" then {resolved_in: env.COMMIT} else {} end) + (if (env.NOTE // "") != "" then {answer: env.NOTE} else {} end)
# One answer, as the status line prints it.
ANNOTATION_ANSWER = $(ANNOTATIONS_CLEAN) "\(.id)  \(.status)  \(.resolved_in // "")  \(.answer // "")" | clean

# The shell's helpers: `fetch` saves an answer of curl, with the netrc where there is one, and prints its HTTP status;
# `api` keeps the answer in $$answer and fails unless it succeeded; `part` fetches a part of annotation $$ID into $$dir,
# where 404 means it has none and any other failure stops.
define ANNOTATIONS_SH
fetch() { \
	out=$$1; shift; \
	if [ -f "$$ANNOTATIONS_NETRC" ]; then set -- --netrc-file "$$ANNOTATIONS_NETRC" "$$@"; fi; \
	curl --silent --show-error --output "$$out" --write-out '%{http_code}' "$$@"; \
}; \
api() { \
	code=$$(fetch "$$answer" "$$@") || exit 1; \
	case "$$code" in 2??) ;; *) echo "HTTP $$code" >&2; return 1 ;; esac; \
}; \
part() { \
	code=$$(fetch "$$dir/$$1" "$$ANNOTATIONS_API/$$ID/$$1") || exit 1; \
	case "$$code" in 200) ;; 404) rm -f "$$dir/$$1" ;; *) rm -f "$$dir/$$1"; echo "$$1: HTTP $$code" >&2; exit 1 ;; esac; \
}; \
answer=$$(mktemp); trap 'rm -f "$$answer"' EXIT;
endef

annotations:: ## List the app's open annotations, the newest first: make annotations [LIST=in_progress] [LIMIT=100]
	$(ANNOTATIONS_CHECK)
	$(call annotation_status,$(LIST),LIST)
	$(call annotation_only,$(LIMIT),$(ANNOTATION_DIGITS),LIMIT is no number)
	@$(ANNOTATIONS_SH) \
	api --get --data-urlencode "app=$$ANNOTATIONS_APP" --data-urlencode "status=$$LIST" \
		--data-urlencode "limit=$$LIMIT" "$$ANNOTATIONS_API" || exit 1; \
	jq -r '$(ANNOTATIONS_ROW)' "$$answer"

annotation:: ## Fetch an annotation, its pictures, context and console into local/annotations/<id>: make annotation ID=<id>
	$(ANNOTATIONS_CHECK)
	$(ANNOTATION_ID_CHECK)
	@$(ANNOTATIONS_SH) \
	dir="$$ANNOTATIONS_DIR/$$ID"; \
	api "$$ANNOTATIONS_API/$$ID" || { echo "annotation $$ID could not be fetched" >&2; exit 1; }; \
	mkdir -p "$$dir"; jq . "$$answer" >"$$dir/record.json"; \
	for name in crop.png frame.png context.json console.json; do part "$$name"; done; \
	ls "$$dir"

annotation-status:: ## Answer an annotation: make annotation-status ID=<id> [STATUS=done|in_progress|wont_do|open] [COMMIT=<sha>] [NOTE=<answer>]
	$(ANNOTATIONS_CHECK)
	$(ANNOTATION_ID_CHECK)
	$(call annotation_status,$(STATUS),STATUS)
	$(if $(COMMIT),$(call annotation_only,$(patsubst %+dirty,%,$(COMMIT)),$(ANNOTATION_HEX),COMMIT is no commit))
	@$(ANNOTATIONS_SH) \
	change=$$(jq -n '$(ANNOTATION_CHANGE)'); \
	api --request PATCH --header 'content-type: application/json' --data "$$change" "$$ANNOTATIONS_API/$$ID" || exit 1; \
	jq -r '$(ANNOTATION_ANSWER)' "$$answer"

.PHONY: annotations annotation annotation-status
