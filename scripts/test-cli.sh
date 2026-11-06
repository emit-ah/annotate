#!/usr/bin/env bash
# Runs the CLI (cli/annotations.mk) against the service built in build/target: lists, fetches and answers an
# annotation with a context and a console, and checks that what callers and annotations bring can neither run
# commands nor steer the terminal.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
server=${ANNOTATIONS_SERVER:-$root/build/target/debug/annotations-server}
work=$(mktemp -d)
port=$((20000 + RANDOM % 20000))
pid=
trap 'if [[ -n $pid ]]; then kill "$pid" 2>/dev/null || true; fi; rm -rf "$work"' EXIT

fail() {
	echo "$*" >&2
	exit 1
}

ANNOTATIONS_OPEN=local ANNOTATIONS_LISTEN=127.0.0.1:$port ANNOTATIONS_DATABASE=$work/annotations.db \
	"$server" serve >"$work/server.log" 2>&1 &
pid=$!
ready=
for _ in $(seq 50); do
	if curl --silent --fail "http://127.0.0.1:$port/health/ready" >/dev/null; then
		ready=yes
		break
	fi
	sleep 0.1
done
[[ -n $ready ]] || fail "the service did not start: $(cat "$work/server.log")"

crop=$(base64 -w0 "$root/scripts/fixtures/pixel.png")
# A comment with a colour escape, a bidi override and a zero-width space.
body=$(jq -n --arg crop "$crop" '{
	app: "demo", comment: "Too dark.\u001b[31m ‮gnp.exe​", path: "/", version: "1.4.0",
	viewport: {width: 800, height: 600, pixel_ratio: 1},
	target: {kind: "region", rect: {x: 0, y: 0, width: 10, height: 10}},
	crop: $crop, context: {turns: [{tool: "search"}]},
	console: [{kind: "warn", time: "2026-11-06T10:00:00Z", message: "slow"}]
}')
id=$(curl --silent --fail -H 'content-type: application/json' --data "$body" \
	"http://127.0.0.1:$port/api/v1/annotations" | jq -r .id)

mk() {
	make --no-print-directory -C "$work" -f "$root/cli/annotations.mk" ANNOTATIONS_APP=demo \
		ANNOTATIONS_URL="http://127.0.0.1:$port" ANNOTATIONS_NETRC=/nonexistent "$@"
}

# Refused before any shell or request: each of these must fail and run nothing.
refused() {
	if mk "$@" >"$work/refused.log" 2>&1; then
		fail "make $* was not refused"
	fi
	[[ ! -e $work/pwned ]] || fail "make $* ran a command"
}

listed=$(mk annotations)
grep -q "$id" <<<"$listed" || fail "the list lacks the annotation"
if LC_ALL=C grep -q $'\e\|\xe2\x80\xae\|\xe2\x80\x8b' <<<"$listed"; then
	fail "the list printed a control, bidi or zero-width character"
fi
[[ $(mk annotations LIMIT=1 | wc -l) -eq 1 ]] || fail "the list ignored its limit"

mk annotation ID="$id" >/dev/null
for part in record.json crop.png context.json console.json; do
	[[ -s $work/local/annotations/$id/$part ]] || fail "$part was not fetched"
done
[[ ! -e $work/local/annotations/$id/frame.png ]] || fail "a missing frame was written"
jq -e '.turns[0].tool == "search"' "$work/local/annotations/$id/context.json" >/dev/null

missing=01900000-0000-7000-8000-000000000000
refused annotation ID=$missing
[[ ! -e $work/local/annotations/$missing/record.json ]] || fail "a problem was written as a record"

answered=$(NOTE='Lighter now.' mk annotation-status ID="$id" STATUS=done COMMIT=5c1e9a2)
[[ $answered == "$id  done  5c1e9a2  Lighter now." ]] || fail "the answer reads $answered"
# A note with make's functions in it stays text, also under a shell that refuses unset variables.
injection="\$(shell touch pwned)"
mk annotation-status ID="$id" STATUS=in_progress NOTE="$injection" >/dev/null
[[ ! -e $work/pwned ]] || fail "NOTE ran a command"
curl --silent "http://127.0.0.1:$port/api/v1/annotations/$id" | jq -e --arg note "$injection" '.answer == $note' >/dev/null ||
	fail "the note did not arrive as written"
mk annotation-status ID="$id" STATUS=done SHELL='/bin/sh' .SHELLFLAGS='-u -c' >/dev/null
[[ -z $(mk annotations) ]] || fail "an annotation done is still listed as open"

refused annotation ID="x'; touch $work/pwned; '"
refused annotation-status ID="$id" COMMIT="5c1e9a2'; touch $work/pwned; '"
refused annotation-status ID="$id" STATUS="done'; touch $work/pwned; '"
refused annotation-status ID="$id" STATUS=fixed
refused annotations LIST="open'; touch $work/pwned; '"
refused annotations LIMIT="1; touch $work/pwned"
refused annotations ANNOTATIONS_APP="demo'; touch $work/pwned; '"
refused annotations ANNOTATIONS_URL=http://annotations.example
refused annotations ANNOTATIONS_URL=http://localhost.example
refused annotations ANNOTATIONS_URL=https://annotations.example
grep -q 'ANNOTATIONS_NETRC /nonexistent is missing' "$work/refused.log" || fail "a missing netrc was not named"
echo "the CLI lists, fetches and answers annotations, and refuses what is no annotation's"
