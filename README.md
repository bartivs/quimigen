# QuimiGen

Telegram agent that turns a curriculum file or public URL into a cited, reviewable study plan and uses **Trigger.dev** to deliver one approved problem per day.

Repository: https://github.com/bartivs/quimigen

## MVP status

| Capability | Status |
|---|---|
| Generic `.txt`, `.md`, `.pdf`, or HTTPS curriculum intake | Implemented |
| Exa URL extraction and bounded research | Implemented; requires key |
| OpenRouter structured plan generation | Implemented; requires key |
| Full queue summary and Telegram preview | Implemented |
| Exact owner/version approval | Implemented |
| Per-plan Trigger.dev cron with IANA timezone | Implemented; requires project/key |
| Idempotent daily Telegram delivery | Implemented |
| Pause, confirmed resume, hint, and solution commands | Implemented |
| Deterministic no-network flow | Implemented |
| Live credentialed end-to-end verification | Not run in this repository |
| Production durable storage | V2 / not built |

The safety invariant is fixed: **scheduled jobs deliver only immutable problems from the exact queue version the user approved. They never generate new outbound content.**

## Architecture

```text
Telegram file/URL
  → safe extraction
  → OpenRouter outline
  → Exa research with URLs
  → OpenRouter full plan + problem queue
  → local JSON version/hash
  → user approval
  → Trigger.dev per-plan schedule
  → one approved Telegram problem/day + receipt
```

The local JSON adapter is deliberate hackathon scope. It lets the bot and the Trigger.dev **local dev worker** share state through one absolute `QUIMIGEN_STATE_FILE`. Replace it with a durable database before deploying the task to Trigger.dev cloud.

## Quick start: fixture flow

Requires Node.js 22+.

```bash
npm ci
npm run verify
npm run demo:flow
```

The fixture flow uses no Telegram, Exa, OpenRouter, or Trigger credentials and visibly prints `DEMO FIXTURE` / `TRIGGER SIMULATED`.

## Live setup

1. Create a Telegram bot with BotFather.
2. Create Exa and OpenRouter API keys.
3. Create a Trigger.dev project, copy its project ref, and create a Development environment API key.
4. Install `pdftotext` (usually the `poppler-utils` package) if PDF intake is needed.
5. Configure the app:

```bash
cp .env.example .env
# edit .env; set QUIMIGEN_MODE=live
```

Use an **absolute** state path so both local processes resolve the same file:

```dotenv
QUIMIGEN_STATE_FILE=/absolute/path/to/quimigen/.data/state.json
```

Start Trigger.dev first so the scheduled task exists before approval:

```bash
npm run trigger:dev
```

In a second terminal:

```bash
npm run bot
```

Trigger.dev development schedules fire only while its dev CLI is running.

## Telegram flow

```text
/plan 3 18:00 America/Asuncion
→ send curriculum.md, curriculum.pdf, or one HTTPS URL
→ review summary, sources, and every problem
/approve QG-XXXXXX 1
→ Trigger.dev schedule receipt
/status QG-XXXXXX
/pause QG-XXXXXX
/resume QG-XXXXXX
/confirm_resume QG-XXXXXX 1
```

After an entry arrives:

```text
/hint QG-XXXXXX D1
/solution QG-XXXXXX D1
```

`/demo` creates a visibly labeled fixture draft inside a real Telegram chat. In fixture mode, approval creates only a `TRIGGER SIMULATED` schedule.

## Verification

```bash
npm test            # state, providers, bot, scheduling, duplicate/stale delivery
npm run check:trigger
npm run verify
```

See [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) for contracts, [`docs/DEMO.md`](docs/DEMO.md) for the live/fallback runbook, and [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the Gitea → `192.168.1.116` pipeline.

## Limits and trust

- MVP plans contain 1–7 daily entries.
- Telegram-hosted document download is capped at 20 MB.
- Files are temporary and deleted after extraction.
- URL intake is public HTTPS only and fetched through Exa.
- Model citations must exactly match URLs returned by Exa.
- Every generated entry is marked `REVISIÓN REQUERIDA`.
- An uncertain Telegram send is recorded and never retried blindly.
- Stale runs expire and missed days are not backfilled in a burst.
- No names, grades, school identifiers, or student profiles are requested.

## Non-goals

No LMS, grading, OCR, voice, payments, analytics, automatic generation at delivery time, or production multi-tenant storage.
