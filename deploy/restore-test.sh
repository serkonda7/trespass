#!/usr/bin/env bash
# Monthly restore test: restores the DB from Litestream and the latest restic
# snapshot into a throwaway dir, boots a throwaway app on it, checks /health
# and compares boots plus the location and photo counts of live and restored DB.
set -euo pipefail
cd "$(dirname "$0")"
T=$(mktemp -d /tmp/trespass-restore.XXXXXX); NAME=trespass-restore-$$
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; docker run --rm -v "$T":/t alpine rm -rf /t/db /t/uploads >/dev/null 2>&1 || true; rm -rf "$T"; }
trap cleanup EXIT
# Prefer the exact image the live app container runs.
CID=$(docker compose ps -q app 2>/dev/null | head -1)
IMG=${CID:+$(docker inspect --format '{{.Config.Image}}' "$CID" 2>/dev/null)}
if [[ -z "$IMG" ]]; then
  APP_VERSION=${APP_VERSION:-$(sed -n 's/^APP_VERSION=//p' .env | head -1)}
  IMG="trespass-app:${APP_VERSION:-dev}"
fi
if [[ -z "$IMG" || "$IMG" == *"<none>"* || "$IMG" == *" "* || "$IMG" == *$'\n'* || "$IMG" == *":" ]]; then
  echo "FAIL: cannot determine a valid app image (got '${IMG:-<empty>}')" >&2
  exit 1
fi
echo "app image: $IMG"

# Row count of a table in $DATABASE_PATH (read-only), run with `bun -e` inside a
# container. /health does not report counts (it is public), so count directly.
# TODO: locations and photos arrive in the MVP; until then the missing table
# counts as 0 so this script already passes on the Stage 1 schema.
count_js() { echo "import {Database} from \"bun:sqlite\"; const d=new Database(process.env.DATABASE_PATH,{readonly:true}); const t=d.query(\"select count(*) n from sqlite_master where type='table' and name='$1'\").get().n; console.log(t?d.query(\"select count(*) n from $1\").get().n:0)"; }

# Live counts (read-only) to compare against.
LIVE=$(docker compose exec -T app bun -e "$(count_js boots)")
LIVE_LOCATIONS=$(docker compose exec -T app bun -e "$(count_js locations)")
LIVE_PHOTOS=$(docker compose exec -T app bun -e "$(count_js photos)")
echo "live boots: $LIVE, live locations: $LIVE_LOCATIONS, live photos: $LIVE_PHOTOS"

mkdir -p "$T/db" "$T/uploads"; chmod 777 "$T/db" "$T/uploads"
echo "== Litestream restore"
docker run --rm --user 1000:1000 --env-file .env.backup -v "$PWD/litestream.yml:/etc/litestream.yml:ro" -v "$T/db:/restore" \
  litestream/litestream:0.5.18 restore -config /etc/litestream.yml -o /restore/app.sqlite /data/db/app.sqlite

echo "== restic restore (latest uploads)"
docker compose run --rm -T -v "$T/uploads:/restore" restic restore latest --tag uploads --target /restore
LIVE_FILES=$(find data/uploads -type f | wc -l)
REST_FILES=$(find "$T/uploads" -type f | wc -l)
echo "uploads: live $LIVE_FILES files, restored $REST_FILES files"

echo "== throwaway app"
docker run -d --name "$NAME" --network none -e DATABASE_PATH=/data/db/app.sqlite \
  -e BETTER_AUTH_SECRET="restore-test-$(head -c 24 /dev/urandom | base64)" \
  -v "$T/db:/data/db" "$IMG" >/dev/null
for i in $(seq 1 20); do
  H=$(docker exec "$NAME" bun -e 'fetch("http://127.0.0.1:3000/health").then(r=>r.text()).then(console.log).catch(()=>process.exit(1))' 2>/dev/null) && break
  sleep 1
done
echo "health: ${H:-none}"
BOOTS=$(grep -o '"boots":[0-9]*' <<<"${H:-}" | cut -d: -f2)
REST_LOCATIONS=$(docker exec "$NAME" bun -e "$(count_js locations)" 2>/dev/null || true)
REST_PHOTOS=$(docker exec "$NAME" bun -e "$(count_js photos)" 2>/dev/null || true)
echo "locations: live $LIVE_LOCATIONS, restored ${REST_LOCATIONS:-?}"
echo "photos: live $LIVE_PHOTOS, restored ${REST_PHOTOS:-?}"

fail=0
grep -q '"ok":true' <<<"${H:-}" || { echo "FAIL: restored app not healthy"; fail=1; }
[[ -n "$BOOTS" && "$BOOTS" -ge "$LIVE" ]] || { echo "FAIL: restored boots ${BOOTS:-?} < live $LIVE"; fail=1; }
for pair in "locations:$LIVE_LOCATIONS:$REST_LOCATIONS" "photos:$LIVE_PHOTOS:$REST_PHOTOS"; do
  IFS=: read -r label live restored <<<"$pair"
  [[ "$restored" =~ ^[0-9]+$ && "$restored" -ge "$live" ]] || { echo "FAIL: restored $label ${restored:-?} < live $live"; fail=1; }
done
[[ "$REST_FILES" -ge "$LIVE_FILES" ]] || echo "WARN: fewer files restored than live (new uploads since last nightly backup?)"
[[ $fail -eq 0 ]] && echo "RESTORE TEST OK" || exit 1
