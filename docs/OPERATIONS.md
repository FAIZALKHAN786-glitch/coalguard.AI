# Operating CoalGuard in a private pilot

This document describes the deployment topology the code assumes, the exact
reverse-proxy settings it depends on, and the routine procedures an operator
must be able to perform. It does not replace a security review of your own
environment.

## 1. Assumed topology

```text
browser ──HTTPS──▶ reverse proxy (TLS termination) ──HTTP──▶ node server/index.js ──▶ SQLite + uploads
```

- The Node process must **not** be reachable directly from the internet. Bind
  it to a private interface or firewall port 3001 to the proxy only.
- TLS terminates at the proxy. The Node process speaks plain HTTP.
- Exactly one proxy hop fronts the application unless you configure more.

## 2. Required environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `NODE_ENV=production` | yes | Enables the strict mode flags below. |
| `DEMO_MODE=false` | yes | Refuses demonstration accounts and demonstration databases. |
| `DATABASE_PATH` | yes | SQLite file on persistent storage (for example `/app/data/production.sqlite`). |
| `ADMIN_EMAIL` | first start | Validated mailbox for the initial administrator. A real address you control. |
| `ADMIN_PASSWORD` | first start | 12+ characters, supplied from your secret manager. Changing it later does **not** rotate an existing account. |
| `COOKIE_SECURE=true` | yes with HTTPS | Adds the `Secure` attribute to session cookies. Startup fails if `APP_ORIGIN` is HTTPS and this is not true. |
| `APP_ORIGIN` | when the proxy rewrites `Host` | Exact public origin, for example `https://coalguard.example.in`. No path, no wildcard. |
| `TRUST_PROXY` | when the proxy is not on the same host | Forwarded-header trust. See below. |
| `PORT` | no | Defaults to 3001. |
| `FRAME_ANCESTORS` | no | Extra host sources allowed to frame the UI (`frame-ancestors`). Unset means `'self'` only. |
| `AI_ENABLED`, `AI_ALLOWED_HOSTS`, provider keys | no | External AI. See [SECRETS.md](SECRETS.md). |

`ADMIN_EMAIL` and `ADMIN_PASSWORD` are only required when the database has no
users yet. They are never used to reset an existing password.

## 3. `TRUST_PROXY` and forwarded headers

`TRUST_PROXY` decides which forwarding hops the application believes. It
defaults to `loopback`, which trusts a proxy on the same host only. Accepted
values:

- `false` – trust nothing. Client addresses are socket addresses. Use when the
  service is directly reachable and rate limiting should follow the peer.
- `1` … `5` – trust that many proxy hops.
- `loopback`, `linklocal`, `uniquelocal` – trust the address classes.
- A comma-separated CIDR list of your proxy addresses, for example
  `10.0.0.0/8,192.168.1.0/24`.

`TRUST_PROXY=true` is refused at startup: trusting every forwarder lets any
client forge `X-Forwarded-For` and mint a fresh rate-limit bucket. The resolved
value is printed once at startup.

- **Same-host nginx/caddy:** leave it unset (`loopback`).
- **Container or separate-host proxy:** set the proxy address or subnet. If the
  proxy sits on a Docker bridge network, use that bridge subnet.
- Verify after deployment by sending a request with a forged
  `X-Forwarded-For` from a machine that is *not* the proxy and checking that the
  limiter still counts the real caller. The regression test in
  `tests/hardening.test.js` ("a forged X-Forwarded-For cannot mint fresh
  rate-limit buckets") demonstrates the mechanism.

### nginx

```nginx
server {
  listen 443 ssl http2;
  server_name coalguard.example.in;

  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;

  client_max_body_size 12m;         # the API accepts 10 MB uploads

  location /api/events {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;            # SSE must stream
    proxy_read_timeout 1h;
  }

  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

With this file, nginx connects from `127.0.0.1`, so the default `loopback` trust
is correct. `X-Forwarded-For` must be appended (`$proxy_add_x_forwarded_for`),
never set from client input, and the proxy must not forward a client-supplied
value if it is the only hop.

### Caddy

```caddy
coalguard.example.in {
  reverse_proxy 127.0.0.1:3001 {
    flush_interval -1            # stream SSE responses
  }
}
```

Caddy sets `Host`, `X-Forwarded-For` and `X-Forwarded-Proto` itself and runs on
the same host in this example.

## 4. Health, readiness and monitoring

| Endpoint | Meaning |
| --- | --- |
| `GET /api/health` | Process is up. Use for liveness. Never rate limited. |
| `GET /api/ready` | Database reachable **and** schema at the version this build expects. Use for readiness. Returns 503 with `{"ready":false}` otherwise. |
| `GET /api/config` | Public flags (`demo`, `embeddedPreview`, `version`). |

Both health endpoints bypass the rate limiter so a monitor cannot be throttled.

Alert on:

- readiness returning 503 for more than two consecutive checks;
- process restarts, and any startup error mentioning `ADMIN_`, `TRUST_PROXY`,
  `COOKIE_SECURE`, `migration` or `demonstration database`;
- `429` rates rising across many accounts (possible abuse or a misconfigured
  proxy);
- documents stuck in `processing` (see §6);
- free disk below 20% (SQLite WAL and uploads grow together);
- audit verification failing (`GET /api/audit/verify` returns `valid:false`).

There is no metrics endpoint and no built-in alert delivery. Collect container
logs and expose them to your existing monitoring.

## 5. Backup and restore

Back up the **database and the upload directory together**; they are only
consistent as a pair. The upload directory is always `uploads/` beside
`DATABASE_PATH` (for example `/app/data/uploads` when
`DATABASE_PATH=/app/data/production.sqlite`). Mount both on the same persistent
volume.

1. Consistent database snapshot. Do not copy a live WAL database with `cp`:
   ```bash
   node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.env.DATABASE_PATH);d.prepare('VACUUM INTO ?').run(process.argv[1]);d.close()" /backup/coalguard-$(date +%F).sqlite
   ```
   `VACUUM INTO` produces a single consistent file while the server keeps
   running.
2. Copy uploads: `cp -a /app/data/uploads /backup/uploads-$(date +%F)`.
3. Encrypt both and store them off the host.
4. Restore: stop the service, place the snapshot at `DATABASE_PATH`, restore the
   uploads directory next to it, start the service.
5. Verify the restore before trusting it:
   ```bash
   curl -fsS https://coalguard.example.in/api/ready
   ```
   then sign in and check `GET /api/audit/verify` reports `valid:true`.

`tests/migrations.test.js` ("backup and restore returns both database rows and
private uploads") runs this procedure against a temporary database and asserts
that records, audit entries, audit-chain validity and uploaded file bytes all
survive. Restoring a database **without** its uploads leaves downloadable
documents missing while their metadata remains.

### Upgrades and rollback

Migrations in `server/db.js` run automatically at startup, inside a
transaction, and only add tables, columns or indexes — they never drop data.
`PRAGMA user_version` records the applied version. If a migration fails the
transaction rolls back, the version stays unchanged and the process refuses to
start, so an interrupted upgrade leaves the previous database usable.

Rollback: restore the pre-upgrade snapshot **and** its uploads directory, then
run the previous application version. The application also refuses to start
against a database whose `user_version` is newer than the build, rather than
running with an unknown schema.

```bash
# Upgrade
docker compose pull && docker compose up -d
curl -fsS https://coalguard.example.in/api/ready
# Rollback
docker compose down
cp /backup/coalguard-<previous>.sqlite /srv/coalguard/data/production.sqlite
rsync -a --delete /backup/uploads-<previous>/ /srv/coalguard/data/uploads/
docker compose run --rm coalguard-previous
```

## 6. Routine operational tasks

- **Stuck document extraction.** Documents whose extraction was interrupted by a
  restart are marked `failed` at startup so they are never left in
  `processing`; an officer or administrator can retry them from the Documents
  page. Uploads are refused with `503` while 8 extractions are already pending
  (`MAX_PENDING_EXTRACTIONS`).
- **Session hygiene.** Expired sessions are pruned when a new session is
  created. To revoke a specific user's sessions, delete their rows from
  `sessions`; deleting a user requires revoking sessions in the same
  transaction because SQLite foreign keys reference the user.
- **Disk growth.** Extracted text is capped at 250,000 characters per document
  and uploads at 10 MB each. Set an upload retention policy and purge the
  filesystem and `documents` rows together.
- **Rate limits.** 30 sign-in attempts per 15 minutes per address, 20 uploads
  per 10 minutes, 10 AI requests per minute per account, 600 general API
  requests per minute per account, and a 1,200-per-minute process ceiling. They
  are in-process and therefore per instance.

## 7. Deployment checklist

- [ ] `NODE_ENV=production`, `DEMO_MODE=false`, fresh `DATABASE_PATH`.
- [ ] `ADMIN_EMAIL`/`ADMIN_PASSWORD` from a secret manager; MFA on the host.
- [ ] TLS terminated by the proxy; `COOKIE_SECURE=true`; HSTS enabled at the proxy.
- [ ] `TRUST_PROXY` set to the real proxy addresses; the API port is not
      internet-facing.
- [ ] `APP_ORIGIN` set if the proxy rewrites `Host`.
- [ ] `/api/health` and `/api/ready` monitored; readiness 503 alerts wired up.
- [ ] Backups scheduled, encrypted, and a restore rehearsed (see §5).
- [ ] Upload storage and the database on the same persistent volume, owned by
      the runtime user (`node` in the supplied image).
- [ ] `npm audit --omit=dev --audit-level=high` clean at the deployed commit.
- [ ] External AI left disabled unless data-handling approval exists.
- [ ] Sign-in, role restrictions, a document download, an export and sign-out
      verified on the real origin.
- [ ] Roster reviewed; unused accounts removed with their sessions.

## 8. Incident-response checklist

1. **Contain.** Put the proxy in maintenance mode or unplug the API port. Keep
   the database volume intact: it is the evidence.
2. **Preserve evidence.** Snapshot the database with `VACUUM INTO`, copy the
   uploads directory and the reverse-proxy logs. Do not edit or vacuum the live
   database in place.
3. **Assess.** Verify the audit chain (`GET /api/audit/verify`). `valid:false`
   with a `brokenAt` value means stored entries were altered or reordered;
   `valid:false` with a reason about the anchored length means entries were
   removed. Export the audit log and store it off-host.
4. **Revoke.** Delete affected `sessions` rows or rotate credentials. Rotate any
   AI provider key that the deployment could reach — assume it is exposed if the
   process was compromised.
5. **Restore.** Rebuild from a trusted snapshot and its uploads; confirm
   `/api/ready` and a normal sign-in.
6. **Report.** Record what happened, the timeline, which records were affected,
   and what independent specialists must review. Do not describe this product as
   a certified or statutory safety system in any incident communication.

## 9. Limits that remain after this work

- SQLite, local uploads and in-process rate limits mean **one instance**. Two
  replicas would not share sessions, limits or event delivery.
- Analytical endpoints read their scoped records into memory: at 50,000 records
  the dashboard measured p95 ≈ 336 ms and notifications ≈ 337 ms with a ~2 MB
  response. The notification list is capped at 200 entries; the dashboard scan is
  capped at 20,000 rows per request and reports `truncated:true` when it hits
  that ceiling.
- There is no MFA, SSO, self-service password reset, outbound email/SMS delivery,
  malware scanning, or external audit anchoring. See the audit report's
  "remaining blockers".
