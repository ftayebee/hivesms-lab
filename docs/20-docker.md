# 20 · Running with Docker

The whole product runs from one Compose file, on any machine with Docker: no PHP, Node or MySQL
needed on the host.

| Service | What it does | Published |
|---|---|---|
| `web` | Next.js panel. Every feature runs on the Laravel API (`LARAVEL_FEATURES=all`) | Yes, `127.0.0.1:3000` |
| `api` | Laravel API on Apache | No |
| `scheduler` | Sends queued SMS and emails, launches campaigns, runs housekeeping | No |
| `setup` | One-shot job: creates the schema and the example plans, then exits | No |
| `db` | MariaDB 11.4 | No |
| `caddy` | Optional HTTPS with automatic certificates (`--profile tls`) | Yes, 80 and 443 |

Browsers and customers' servers only talk to `web`, which proxies the customer REST API and
provider webhooks to `api`.

## Start

```bash
sh docker/init-env.sh
```

```bash
docker compose --env-file .env.docker up -d --build
```

Then open http://localhost:3000. The first build takes several minutes.

`docker/init-env.sh` creates `.env.docker` with new random secrets. Keep a safe copy: `API_KEY_PEPPER`
and `SETTINGS_ENCRYPTION_KEY` protect stored data, and changing them breaks existing API keys and
encrypted settings.

## Create the first admin

Register nothing for this: the command creates the account, and prints a single-use link for setting
its password (valid 60 minutes).

```bash
docker compose --env-file .env.docker exec api php artisan platform:bootstrap-owner you@example.com --name="Your Name"
```

If you already registered with that address, it promotes your account instead. Sign in at `/admin`.

## Go live

Edit `.env.docker`, then run the `up` command above again.

1. **Domain and HTTPS:** set `APP_URL=https://your-domain` and `SITE_DOMAIN=your-domain`, point DNS at
   the server, and add `--profile tls` to the command. Session cookies are HTTPS-only outside
   `localhost`, so sign-in does not work over plain HTTP on a real domain.
2. **SMS:** set `SMS_PROVIDER_API_KEY` and `SMS_DEFAULT_SENDER_ID`. The server's IP may need allowing in
   the Automas account.
3. **Email:** set `MAIL_MAILER=smtp` and the `MAIL_*` values. With `log`, emails only reach the
   container logs, so new users can't verify their address.
4. **Google sign-in (optional):** set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, with
   `<APP_URL>/api/auth/google/callback` as the authorized redirect URI in Google Cloud.

Admin → Settings overrides `SMS_PROVIDER` once that setting has been saved.

## Everyday commands

```bash
docker compose --env-file .env.docker logs -f api scheduler web
```

```bash
docker compose --env-file .env.docker exec api php artisan app:deploy-check
```

Back up the database (keep the file safe, it contains customer data):

```bash
docker compose --env-file .env.docker exec db sh -c 'mariadb-dump -u root -p"$MARIADB_ROOT_PASSWORD" --single-transaction "$MARIADB_DATABASE"' > backup.sql
```

Update: pull the new code and run the `up` command again. `setup` applies new migrations first.

`docker compose down` keeps your data. **`docker compose down -v` deletes the database and uploaded
documents.**

## Volumes

| Volume | Holds |
|---|---|
| `dbdata` | The database |
| `apistorage` | Sender ID documents and API storage |
| `webdata` | Panel data directory |
| `caddydata` | HTTPS certificates |

## Checks

`.github/workflows/docker.yml` builds and starts the full stack on every push to the `docker` branch,
then checks the panel, the API, the pricing data and the scheduler.
