#!/bin/sh
# One-command deploy/update of the full stack on an Ubuntu/Debian VPS (docs/20-docker.md).
#
#   sh docker/vps-deploy.sh sms.example.com                  # this stack owns ports 80/443 (Caddy, auto HTTPS)
#   sh docker/vps-deploy.sh sms.example.com --behind-proxy   # another web server already owns 80/443
#
# --behind-proxy: no Caddy; the panel listens on WEB_BIND:WEB_PORT (default 127.0.0.1:3100) and the
# existing web server (nginx, Traefik, Nginx Proxy Manager, another Caddy) must forward the domain
# to it and handle HTTPS (docs/20-docker.md › Behind an existing web server). Override with
# WEB_PORT=… WEB_BIND=… in the environment, e.g. WEB_BIND=172.17.0.1 for a proxy running in Docker.
#
# First run: installs Docker if missing, creates .env.docker with new random secrets, sets the
# domain and switches the optional modules on, checks DNS and ports, then builds and starts the
# stack with automatic HTTPS (Caddy). Later runs (after `git pull`): rebuild and restart; the
# `setup` service applies new migrations first. .env.docker is never overwritten.
set -eu
cd "$(dirname "$0")/.."

DOMAIN="${1:-}"
MODE="${2:-}"
[ -n "$DOMAIN" ] || { echo "Usage: sh docker/vps-deploy.sh <domain> [--behind-proxy]   e.g. sms.example.com"; exit 1; }
case "$MODE" in ""|--behind-proxy) ;; *) echo "Unknown option: $MODE"; exit 1 ;; esac
[ "$(id -u)" = 0 ] || { echo "STOP: run as root (or with sudo)."; exit 1; }

say() { printf '\n== %s\n' "$*"; }

# ── Docker ─────────────────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker (get.docker.com)"
  command -v curl >/dev/null || { apt-get update -qq && apt-get install -y -qq curl; }
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || { echo "STOP: the docker compose plugin is missing (apt-get install docker-compose-plugin)."; exit 1; }
command -v openssl >/dev/null || apt-get install -y -qq openssl

# ── Configuration ──────────────────────────────────────────────────────────────
setkey() { # setkey KEY VALUE: replace or append KEY=VALUE in .env.docker
  if grep -q "^$1=" .env.docker; then sed -i "s#^$1=.*#$1=$2#" .env.docker; else printf '%s=%s\n' "$1" "$2" >> .env.docker; fi
}
if [ ! -e .env.docker ]; then
  say "Creating .env.docker with new secrets"
  sh docker/init-env.sh
  setkey LARAVEL_FEATURES all,dynamicSms,manualTopups,senderCatalog,reportImport
  for f in FEATURE_DYNAMIC_SMS FEATURE_MANUAL_TOPUPS FEATURE_SENDER_CATALOG FEATURE_REPORT_IMPORT; do setkey "$f" true; done
  echo "Keep a safe copy of .env.docker: its secrets protect API keys and stored settings."
fi
setkey APP_URL "https://$DOMAIN"
setkey SITE_DOMAIN "$DOMAIN"
if [ "$MODE" = --behind-proxy ]; then
  setkey WEB_PORT "${WEB_PORT:-3100}"
  setkey WEB_BIND "${WEB_BIND:-127.0.0.1}"
  PROFILE=""
else
  PROFILE="--profile tls"
fi
chmod 600 .env.docker
PORT="$(grep "^WEB_PORT=" .env.docker | cut -d= -f2)"
BIND="$(grep "^WEB_BIND=" .env.docker | cut -d= -f2)"

# ── Checks (warnings only) ─────────────────────────────────────────────────────
say "Checks"
MYIP="$(curl -4 -fsS https://api.ipify.org 2>/dev/null || true)"
DNSIP="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}')"
if [ -n "$MYIP" ] && [ "$MYIP" = "$DNSIP" ]; then echo "DNS: $DOMAIN -> $MYIP (this server)"
else echo "WARNING: $DOMAIN resolves to '${DNSIP:-nothing}', this server is '${MYIP:-unknown}'. HTTPS starts working once the A record points here."; fi
OURS="$(docker ps -q --filter label=com.docker.compose.project=smsflow 2>/dev/null || true)"
if [ -z "$PROFILE" ]; then
  if [ -z "$OURS" ] && ss -tlnH "( sport = :$PORT )" 2>/dev/null | grep -q .; then
    echo "STOP: port $PORT is already in use. Pick another, e.g.: WEB_PORT=3200 sh docker/vps-deploy.sh $DOMAIN --behind-proxy"; exit 1
  fi
  echo "Proxy mode: the panel will listen on $BIND:$PORT (no Caddy)."
else
  BUSY="$(ss -tlnpH '( sport = :80 or sport = :443 )' 2>/dev/null | grep -v caddy || true)"
  if [ -n "$BUSY" ]; then
    echo "STOP: another program already serves port 80/443:"; echo "$BUSY"
    echo "Run in proxy mode instead:  sh docker/vps-deploy.sh $DOMAIN --behind-proxy"; exit 1
  fi
  command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active" && { ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; echo "ufw: opened 80 and 443"; }
fi
grep -q '^SMS_PROVIDER_API_KEY=.\+' .env.docker || echo "NOTE: SMS_PROVIDER_API_KEY is empty in .env.docker: no SMS will be sent until it is set (or saved in Admin → Settings)."
grep -q '^MAIL_MAILER=log' .env.docker && echo "NOTE: MAIL_MAILER=log: emails only go to the logs. Set MAIL_* in .env.docker for real email."

# ── Build and start ────────────────────────────────────────────────────────────
say "Building and starting (first build takes several minutes)"
# shellcheck disable=SC2086
docker compose --env-file .env.docker $PROFILE up -d --build --remove-orphans

say "Waiting for the panel"
i=0
until docker compose --env-file .env.docker exec -T web node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; do
  i=$((i + 1)); [ "$i" -gt 60 ] && { echo "The panel did not become healthy. Logs: docker compose --env-file .env.docker logs --tail 100 web api setup"; exit 1; }
  sleep 5
done
docker compose --env-file .env.docker ps
echo
if [ -z "$PROFILE" ]; then
  echo "Panel is up on http://$BIND:$PORT. Now point the existing web server at it for https://$DOMAIN:"
  echo "  docs/20-docker.md › Behind an existing web server"
else
  echo "Running: https://$DOMAIN"
fi
echo "First admin (prints a one-time link to set the password):"
echo "  docker compose --env-file .env.docker exec api php artisan platform:bootstrap-owner you@example.com --name=\"Your Name\""
