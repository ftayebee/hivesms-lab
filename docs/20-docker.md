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

### One command on a VPS

On an Ubuntu/Debian VPS whose domain (or subdomain) already points at it, as root:

```bash
git clone https://github.com/ftayebee/hivesms-lab.git /opt/mzsms && cd /opt/mzsms
sh docker/vps-deploy.sh sms.example.com
```

It installs Docker if needed, creates `.env.docker` with new secrets (optional modules on), sets
`APP_URL`/`SITE_DOMAIN`, warns about DNS and busy ports 80/443, and starts everything with HTTPS.
To update later: `git pull && sh docker/vps-deploy.sh sms.example.com` (it keeps `.env.docker`).
Then set SMS and email in `.env.docker` (see *Go live*) and run the script again.

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

5. **Optional modules:** set `FEATURE_DYNAMIC_SMS`, `FEATURE_MANUAL_TOPUPS`, `FEATURE_SENDER_CATALOG`,
   `FEATURE_REPORT_IMPORT` to `true` as wanted, and list the same modules in `LARAVEL_FEATURES`
   (`all,dynamicSms,manualTopups,senderCatalog,reportImport`). Both are needed for a module to appear.

Admin → Settings overrides `SMS_PROVIDER` once that setting has been saved.

### Subdomain of a domain whose website is hosted elsewhere

The main site can stay where it is (for example Namecheap shared hosting); only one subdomain,
say `sms.example.com`, points at this server. Everything (panel, customer API, webhooks) is
served on that one name; the Laravel API is internal and needs no DNS record.

1. **Find where the domain's DNS is managed.** Namecheap → Domain List → *Manage* → *Nameservers*:
   - *Namecheap Web Hosting DNS* (`dns1/dns2.namecheaphosting.com`, the usual case with a Stellar
     plan): edit the zone in **cPanel → Zone Editor**.
   - *Namecheap BasicDNS*: edit it in **Advanced DNS** on the domain page.
   - Cloudflare or other nameservers: edit it there.
2. **If the subdomain already exists in cPanel** (cPanel → Domains), remove it there first:
   cPanel recreates its own `A` record pointing at the shared server and AutoSSL keeps trying to
   issue a certificate for it.
3. **Add the record**: type `A`, name `sms`, value = the VPS's public IPv4, TTL 5 min / 300.
   Add an `AAAA` record only if the VPS has working IPv6 (otherwise Caddy's certificate check can
   fail for IPv6 visitors). Do not touch the `@`, `www`, `mail` or `MX` records: the main website
   and its email keep working unchanged.
4. **Wait for DNS**: `nslookup sms.example.com 1.1.1.1` must return the VPS IP (usually minutes).
5. **On the VPS** open ports 80 and 443 (e.g. `ufw allow 80,443/tcp`), then in `.env.docker` set
   `APP_URL=https://sms.example.com` and `SITE_DOMAIN=sms.example.com` and start with HTTPS:

   ```bash
   docker compose --env-file .env.docker --profile tls up -d --build
   ```

   Caddy gets the Let's Encrypt certificate automatically once DNS points at the server. With
   Cloudflare, keep the record *DNS only* (grey cloud) until the certificate is issued.
6. **Email**: to send from `no-reply@example.com`, create that mailbox where the domain's email
   lives (cPanel → Email Accounts on Namecheap) and use it in `MAIL_*` (`MAIL_HOST=mail.example.com`,
   port 465, `MAIL_SCHEME=smtps`). Some VPS providers block outgoing port 25/465/587 by default;
   ask them to open it if mail does not leave.
7. If your SMS gateway allow-lists IPs (Automas does), add the **VPS** IP there.

Admin → Overview shows the Automas balance and how many messages it can send. Automas has no price
API, so keep `AUTOMAS_RATE_MASKING` and `AUTOMAS_RATE_NON_MASKING` in step with its Price List page, or
save the rates in Admin → Costs & margins, which take priority.

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
