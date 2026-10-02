# Production deployment

Production is served at <https://sopilka.kattegatt.org/> from the immutable image
`ghcr.io/kattegatt/sopilka-note-decoder:<git-sha>`.

A push or merge to `main` runs linting and tests, builds the production container,
publishes both the commit-SHA tag and the convenience `production` tag to GHCR,
then deploys the exact SHA tag to `/srv/apps/sopilka/` on the VPS. The workflow
checks container health and the public HTTPS endpoint before succeeding.

## GitHub Actions configuration

The `production` environment contains these secrets:

- `VPS_HOST`: public VPS hostname or address;
- `VPS_PORT`: SSH port;
- `VPS_USER`: restricted deployment account;
- `VPS_SSH_KEY`: private key for that account only;
- `VPS_KNOWN_HOSTS`: pinned SSH host key entry.

Image publishing and the temporary image pull authentication use the built-in
`GITHUB_TOKEN`; no long-lived GHCR token is required. Application runtime secrets are required for authentication. Keep them
in `/srv/apps/sopilka/.env` with mode `600`; deployment does not alter that file.
See the one-time backend rollout instructions below.

## Operations

Inspect the running image and container:

```bash
ssh pet-vps 'sudo /usr/local/sbin/sopilka-status'
```

Inspect recent application logs:

```bash
ssh pet-vps 'sudo /usr/local/sbin/sopilka-logs'
```

To redeploy normally, push or merge to `main`. A workflow dispatch can also
redeploy its own commit from the Actions page.

## Rollback

Find a previous successful commit SHA in GitHub Actions or in the image list
reported by `sopilka-status`, then run the **Validate and deploy production**
workflow for that commit if it is still the branch head. For an immediate manual
rollback, use the restricted VPS operation with the full 40-character SHA:

```bash
ssh pet-vps 'sudo /usr/local/sbin/deploy-sopilka <previous-40-character-sha> manual'
```

The command pulls and starts that immutable tag, waits for the container health
check, and verifies the HTTPS endpoint. The previous image remains identifiable
in the local Docker image cache and GHCR.

## First backend rollout (one-time administrator setup)

The image now runs Fastify for both static files and `/api/*`. Existing deployments
only pull a new image: they **do not copy** `compose.yml` or the helper scripts.
Before deploying this revision, an administrator with normal VPS access must:

1. Replace `/srv/apps/sopilka/compose.yml` with this repository's Compose file.
2. Replace `/usr/local/sbin/deploy-sopilka` with the updated helper (mode `755`).
3. Create `/srv/apps/sopilka/.env` from `.env.example`, mode `600`. Set
   `BETTER_AUTH_URL=https://sopilka.kattegatt.org`, a randomly generated
   `BETTER_AUTH_SECRET` (at least 32 characters).
4. Deploy the immutable image as usual. Verify registration with a login and
   password, login, and project synchronization in addition to the automated
   health check. No SMTP service or email confirmation is required.

The restricted deployment SSH key cannot install files or configure runtime secrets. Do not
broaden that key's permissions. Supply runtime secrets on the VPS only; they are
never needed by the frontend build or stored in `VITE_*` variables.

The named Docker volume `sopilka-data` persists `/data/sopilka.sqlite` across
image replacements. SQLite uses WAL. Auth and project schema migrations run before
the server begins accepting traffic; project schema changes are additive. Logs
must not contain cookies, passwords or authentication tokens. `/api/health`
checks the live database as well as the HTTP process.

Passwords are stored as scrypt hashes by Better Auth. Public authentication routes
accept only login/password registration, login, session checks and logout. Email
verification and password-reset routes are disabled; automatic password recovery
is not available in this version.

## Backups and restore

Before subsequent schema changes, and regularly during operation, take a coherent
SQLite backup (the backup API includes committed WAL data):

```bash
cd /srv/apps/sopilka
sudo docker compose --env-file .image exec app node scripts/backup.mjs
```

Backups are written under `/data/backups/`. Copy them off the VPS; backups in the
same volume alone do not protect against disk failure. Restrict access: they
contain private notes and authentication records.

To restore, stop the application, mount `sopilka-data` into a temporary container,
replace `sopilka.sqlite` with the selected backup, remove any stale
`sopilka.sqlite-wal` and `sopilka.sqlite-shm`, and ensure the restored file belongs
to UID/GID `1000:1000`. Start the application and check `/api/health`, login, and
project retrieval. Do not replace database files while the server is running.
Never use `docker compose down -v` for an ordinary rollback.

Image rollback does not roll back the database. Keep the same auth secret across
releases. For a rollback to the original frontend-only image, the administrator
must also restore the earlier deployment helper, because that image has no
`/api/health`; retain the data volume for future recovery.
