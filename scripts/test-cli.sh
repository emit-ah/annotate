#!/usr/bin/env bash
# Runs the CLI (mk/annotations.mk) against the service built in build/target: lists, fetches and answers an annotation
# with a context and a console, and checks that control characters in a comment never reach the terminal.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
server=${ANNOTATIONS_SERVER:-$root/build/target/debug/annotations-server}
work=$(mktemp -d)
port=$((20000 + RANDOM % 20000))
trap 'kill "$pid" 2>/dev/null || true; rm -rf "$work"' EXIT

ANNOTATIONS_OPEN=local ANNOTATIONS_LISTEN=127.0.0.1:$port ANNOTATIONS_DATABASE=$work/annotations.db \
	"$server" serve >"$work/server.log" 2>&1 &
pid=$!
for _ in $(seq 50); do
	curl --silent --fail "http://127.0.0.1:$port/health/ready" >/dev/null && break
	sleep 0.1
done

crop=$(base64 -w0 "$root/scripts/fixtures/pixel.png")
body=$(jq -n --arg crop "$crop" '{
	app: "demo", comment: "Too dark.\u001b[31m", path: "/", version: "1.4.0",
	viewport: {width: 800, height: 600, pixel_ratio: 1},
	target: {kind: "region", rect: {x: 0, y: 0, width: 10, height: 10}},
	crop: $crop, context: {turns: [{tool: "search"}]},
	console: [{kind: "warn", time: "2026-11-06T10:00:00Z", message: "slow"}]
}')
id=$(curl --silent --fail -H 'content-type: application/json' --data "$body" \
	"http://127.0.0.1:$port/api/v1/annotations" | jq -r .id)

mk() { make --no-print-directory -C "$work" -f "$root/mk/annotations.mk" ANNOTATIONS_APP=demo \
	ANNOTATIONS_URL="http://127.0.0.1:$port" ANNOTATIONS_NETRC=/nonexistent "$@"; }

listed=$(mk annotations)
grep -q "$id" <<<"$listed"
if grep -q $'\e' <<<"$listed"; then
	echo "the list printed a control character" >&2
	exit 1
fi
mk annotation ID="$id" >/dev/null
for part in record.json crop.png context.json console.json; do
	test -s "$work/local/annotations/$id/$part"
done
test ! -e "$work/local/annotations/$id/frame.png"
jq -e '.turns[0].tool == "search"' "$work/local/annotations/$id/context.json" >/dev/null
NOTE='Lighter now.' mk annotation-status ID="$id" STATUS=done COMMIT=5c1e9a2 | grep -q 'done  5c1e9a2  Lighter now.'
test -z "$(mk annotations)"
if mk annotation ID="x'; touch $work/pwned; '" 2>/dev/null || test -e "$work/pwned"; then
	echo "an ID that is no annotation's reached the API" >&2
	exit 1
fi
echo "the CLI lists, fetches and answers annotations"
