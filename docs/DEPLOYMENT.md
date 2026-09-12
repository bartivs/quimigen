# Homelab deployment

QuimiGen is staged on the `headphones` Docker LXC (`192.168.1.116`) under `/opt/quimigen`. It has no HTTP port: the native surface is Telegram.

## Topology

```text
Gitea 192.168.1.117
  └─ Actions runner
      └─ rsync + SSH
          └─ 192.168.1.116:/opt/quimigen
              ├─ quimigen-bot
              ├─ quimigen-trigger-worker (Trigger.dev local dev worker)
              └─ quimigen-data volume (/data/state.json)
```

The local Trigger.dev worker is deliberate demo scope. It keeps scheduled task execution beside the local JSON store. A Trigger.dev cloud deployment requires replacing JSON with a durable database reachable by both bot and cloud task. The worker is limited to one concurrent run; its image extends the pinned CLI's indexing timeout for this 512 MiB LXC, and Compose reports healthy only after Trigger.dev confirms `Local worker ready`.

## CI/CD

`.gitea/workflows/deploy.yml` runs on pushes to `main` and manual dispatch:

1. `npm ci`, tests, Trigger task import check, and fixture flow;
2. rsync to `/opt/quimigen` without `.env` or state;
3. build `quimigen:local` on the target;
4. run the no-network fixture flow inside the image;
5. start services only when `.env` passes the key-name-only validator.

If keys are absent, the pipeline succeeds after staging and creates `/opt/quimigen/CONFIG_REQUIRED`. It never prints secret values.

## One-time environment configuration

On `192.168.1.116`:

```bash
ssh root@192.168.1.116
cd /opt/quimigen
vi .env
chmod 0600 .env
./scripts/check-deploy-env.sh .env
```

Required values:

- `TELEGRAM_BOT_TOKEN`
- `EXA_API_KEY`
- `OPENROUTER_API_KEY`
- `TRIGGER_PROJECT_REF`
- `TRIGGER_SECRET_KEY` (development environment key used by the bot)
- `TRIGGER_CLI_ACCESS_TOKEN` (personal CLI token for the local worker)

Keep `QUIMIGEN_MODE=live` and `QUIMIGEN_STATE_FILE=/data/state.json`.

After configuration, manually dispatch `test-and-deploy-quimigen` in Gitea Actions, or run:

```bash
docker compose -f compose.prod.yaml up -d --remove-orphans
docker compose -f compose.prod.yaml ps
docker compose -f compose.prod.yaml logs -f --tail=100
```

## Operations

```bash
cd /opt/quimigen
docker compose -f compose.prod.yaml ps
docker compose -f compose.prod.yaml restart
docker compose -f compose.prod.yaml logs -f bot
docker compose -f compose.prod.yaml logs -f trigger-worker
```

The named `quimigen-data` volume persists plans and receipts. Never delete it during routine deployment.
