#!/bin/sh
# Creates .env.docker from the example, with new random secrets. Prints no secret values.
set -eu
cd "$(dirname "$0")/.."

if [ -e .env.docker ]; then
  echo "STOP: .env.docker already exists. Its secrets protect existing data, so it was left alone."
  exit 1
fi
command -v openssl >/dev/null || { echo "STOP: openssl is required."; exit 1; }

umask 077
: > .env.docker
while IFS= read -r line; do
  case "$line" in
    *=CHANGE_ME_HEX) line="${line%=*}=$(openssl rand -hex 24)" ;;
    *=CHANGE_ME_APP_KEY) line="${line%=*}=base64:$(openssl rand -base64 32)" ;;
    *=CHANGE_ME_SECRET) line="${line%=*}=$(openssl rand -hex 32)" ;;
  esac
  printf '%s\n' "$line" >> .env.docker
done < .env.docker.example

echo "Created .env.docker with new secrets. Review it, then run:"
echo "  docker compose --env-file .env.docker up -d --build"
