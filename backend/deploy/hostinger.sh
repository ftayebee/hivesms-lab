#!/usr/bin/env bash
# Deploys/verifies the Laravel API on Hostinger shared hosting over SSH. Run from the backend
# directory on the server:   bash deploy/hostinger.sh <phase>
#
# Phases (run in this order; each stops on the first failure):
#   preflight   read-only: PHP binary/version, extensions, .env sanity (secrets as fingerprints only),
#               database connectivity, migrate:status, schema check. Changes nothing.
#   install     composer install --no-dev, clear + cache config/routes/events. No database writes.
#   migrate     ONLY with --confirm. Creates Laravel's own tables (migrations, cache, cache_locks,
#               jobs, job_batches, failed_jobs); the baseline migration is a guarded no-op on an
#               existing database. Proves the 42 application tables are unchanged (fingerprints).
#   verify      read-only HTTP probes: health, readiness, exposure, HTTPS, CORS.
#   cron        prints the exact cron line for this server. Does NOT install it.
#
# Never runs migrate:fresh / db:wipe / migrate:reset / migrate:rollback / key:generate on an
# existing key, and never starts the worker.
set -euo pipefail

PHASE="${1:-}"
CONFIRM="${2:-}"
cd "$(dirname "$0")/.."
BASE_URL="${BASE_URL:-https://smsbackend.hivelabsbd.com}"
FRONTEND_ORIGIN="${FRONTEND_ORIGIN:-https://sms.hivelabsbd.com}"
PHP="${PHP_BIN:-$(command -v php)}"
SNAP_DIR="storage/app/private/deploy"
mkdir -p "$SNAP_DIR"

say() { printf '\n== %s\n' "$*"; }
die() { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }
env_has() { grep -qE "^$1=.+" .env; }

case "$PHASE" in
preflight)
  say "PHP binary"
  echo "$PHP"; "$PHP" -v | head -1
  command -v composer >/dev/null && composer --version 2>/dev/null | head -1 || echo "composer: not on PATH (try: php composer.phar)"
  [ -f .env ] || die ".env missing: copy .env.example to .env and fill it (see docs/13-staging-deployment.md)"
  [ -d vendor ] || die "vendor/ missing: run the install phase first"
  say "APP_KEY"
  if env_has APP_KEY; then echo "APP_KEY is set — keep it (Laravel does not use it for application data, but never rotate needlessly)"; else echo "APP_KEY empty — safe to create once: $PHP artisan key:generate --force (no application data depends on it)"; fi
  "$PHP" artisan config:clear >/dev/null
  say "Deployment checks (no values printed)"
  "$PHP" artisan app:deploy-check || die "deploy-check failed: fix the FAIL rows above"
  say "Laravel"; "$PHP" artisan --version
  say "Migration status (read-only)"
  "$PHP" artisan migrate:status || echo "(no migrations table yet: expected before the first migrate)"
  say "Database (read-only)"
  "$PHP" artisan db:show || true
  say "Application schema vs expected baseline (read-only)"
  "$PHP" artisan app:schema-check --save="$SNAP_DIR/schema-before.json" || die "the production schema differs from the baseline: do NOT migrate; send the diff above"
  echo; echo "Preflight passed. Nothing was changed."
  ;;

install)
  say "Composer (production dependencies)"
  if command -v composer >/dev/null; then composer install --no-dev --optimize-autoloader --no-interaction
  else "$PHP" composer.phar install --no-dev --optimize-autoloader --no-interaction; fi
  mkdir -p storage/logs storage/framework/{cache,sessions,views} storage/app/private bootstrap/cache
  chmod -R u+rwX,go-rwx storage bootstrap/cache
  say "Caches"
  "$PHP" artisan optimize:clear
  "$PHP" artisan config:cache
  "$PHP" artisan route:cache
  "$PHP" artisan event:cache
  echo "Install done. No database changes were made."
  ;;

migrate)
  [ "$CONFIRM" = "--confirm" ] || die "migrate needs --confirm (it creates Laravel's own tables; read docs/13 first)"
  say "Schema before"
  "$PHP" artisan app:schema-check --save="$SNAP_DIR/schema-before.json" || die "schema differs from baseline: refusing to migrate"
  say "Pending migrations"
  "$PHP" artisan migrate:status || true
  say "Migrate (additive: Laravel tables only)"
  "$PHP" artisan migrate --force
  say "Schema after"
  "$PHP" artisan app:schema-check --save="$SNAP_DIR/schema-after.json" || die "APPLICATION SCHEMA CHANGED — investigate immediately"
  cmp -s "$SNAP_DIR/schema-before.json" "$SNAP_DIR/schema-after.json" || die "before/after snapshots differ"
  echo "The 42 application tables are byte-identical before and after."
  "$PHP" artisan migrate:status
  ;;

verify)
  code() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@"; }
  say "Health"; curl -s --max-time 20 "$BASE_URL/api/v1/health"; echo
  say "Readiness (RED is expected until a real SMS provider + cron exist)"
  # Header via a private temp file: the secret never appears in the process list or output.
  HDR="$(umask 077; mktemp)"
  printf 'Authorization: Bearer %s\n' "$(grep -E '^CRON_SECRET=' .env | head -1 | cut -d= -f2- | tr -d '"')" > "$HDR"
  curl -s --max-time 20 -H "@$HDR" "$BASE_URL/api/v1/internal/ready"; echo
  rm -f "$HDR"
  say "Exposure (must all be 403/404)"
  for p in .env .env.example artisan composer.json composer.lock storage/ storage/logs/laravel.log vendor/ vendor/autoload.php database/ resources/ backend.zip .git/config deploy/hostinger.sh; do
    printf '%-28s %s\n' "/$p" "$(code "$BASE_URL/$p")"
  done
  say "HTTPS"
  printf 'http redirect: %s\n' "$(curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}' --max-time 20 "${BASE_URL/https:/http:}/api/v1/health")"
  curl -sv --max-time 20 "$BASE_URL/api/v1/health" -o /dev/null 2>&1 | grep -E 'subject:|expire date:|issuer:|SSL certificate verify' || true
  say "CORS"
  printf 'frontend origin: %s\n' "$(curl -s -D - -o /dev/null --max-time 20 -X OPTIONS -H "Origin: $FRONTEND_ORIGIN" -H 'Access-Control-Request-Method: POST' "$BASE_URL/api/v1/auth/login" | grep -i '^access-control-allow-origin' | tr -d '\r' || echo none)"
  printf 'foreign origin:  %s\n' "$(curl -s -D - -o /dev/null --max-time 20 -X OPTIONS -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: POST' "$BASE_URL/api/v1/auth/login" | grep -i '^access-control-allow-origin' | tr -d '\r' || echo 'none (correct)')"
  say "Routes"; "$PHP" artisan route:list --path=api/v1 | tail -1
  ;;

cron)
  echo "Cron line for hPanel -> Advanced -> Cron Jobs -> Custom (every minute). Do NOT add it until the SMS provider is verified:"
  echo "* * * * * cd $(pwd) && $PHP artisan schedule:run >> /dev/null 2>&1"
  ;;

*)
  sed -n '2,20p' "$0"; exit 1 ;;
esac
