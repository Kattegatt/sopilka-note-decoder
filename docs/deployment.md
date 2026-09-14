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
`GITHUB_TOKEN`; no long-lived GHCR token is required. Application runtime secrets
are not currently required. If they are added later, keep them in
`/srv/apps/sopilka/.env` with mode `600`; deployment does not alter that file.

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
