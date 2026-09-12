# QuimiGen MVP build plan

## Build status — 2026-09-12

- Slices 1–4 are implemented and covered by local tests.
- Slice 5 operator docs, fixture runbook, and CI are implemented.
- Live credentialed Telegram/Exa/OpenRouter/Trigger.dev verification remains pending because no provider secrets are available in this environment.
- Production cloud persistence remains explicitly out of scope.

## Objective

Build a local-first Telegram agent that turns a curriculum file or public URL into a cited study plan, shows the complete problem queue, automatically seals its exact version, and uses Trigger.dev to deliver one sealed problem per day without a manual approval step.

The MVP is generic across subjects. Chemistry entries may include deterministic checks later; all generated content remains marked for user review.

## Success demo

In under two minutes:

1. Send `/start`, tap **Crear un plan**, and choose days, time, and timezone with inline buttons (or use `/plan 3 18:00 America/Asuncion`).
2. Attach a UTF-8 text/Markdown/PDF curriculum or send one public HTTPS URL.
3. See extracted objectives, Exa sources, a three-day plan summary, and the complete three-problem queue.
4. See that the exact queue version was sealed and the Trigger.dev schedule was created automatically.
5. Trigger the scheduled task in the Trigger.dev dashboard and receive exactly one sealed problem in Telegram.
6. Tap **Pausar entregas** and see that the schedule is disabled.

## Product contract

### Commands

| Command | Result |
|---|---|
| `/start`, `/help` | Show guided inline buttons, supported inputs, and privacy limits. |
| `/plan` | Start a button-guided setup for days, delivery time, and timezone. |
| `/plan <days> <HH:MM> <IANA timezone>` | Advanced shortcut to curriculum intake. MVP range: 1–7 days. |
| `/status [planId]` | Show state, version, next delivery, and delivered count; defaults to the latest owned plan. |
| `/pause [planId]` | Disable future deliveries; defaults to the latest active owned plan. |
| `/resume [planId]` | Reactivate the unchanged sealed version directly. |
| `/schedule [planId]` | Retry schedule creation for a generated queue that remained inactive after a provider failure. |
| `/demo` | Run the same automatically scheduled flow with visibly labeled local fixtures. |

### Input limits

- Telegram documents: `.txt`, `.md`, and `.pdf`, maximum 20 MB.
- URLs: public `https://` only.
- PDF extraction uses local `pdftotext`; failure produces a clear error and no plan.
- Source text is capped before model calls.
- Uploaded files are downloaded to a temporary directory and deleted after extraction.

### Approval invariant (automatic sealing)

The model generates every daily entry before the system approves/seals the queue automatically. The preview includes the full queue, not only its summary. Automatic approval records a SHA-256 hash of the normalized queue and requires no user command. Editing or regenerating increments the version, clears the seal, and pauses/deactivates the schedule until the new complete queue is validated and sealed.

The scheduled task **never invokes a model**. It reads one immutable entry from the exact automatically approved queue version and sends it. This keeps every outbound problem inside the approved set while removing the manual approval step.

## Architecture

```text
Telegram getUpdates
  ├─ file/URL intake → safe extractor
  ├─ OpenRouter pass 1 → curriculum outline + research queries
  ├─ Exa Search → titled URLs + excerpts
  ├─ OpenRouter pass 2 → summary + complete daily queue
  ├─ local JSON store → version/hash/status/receipts
  └─ automatic queue sealing → Trigger.dev schedules.create
                         ↓
Trigger.dev schedules.task(timestamp, timezone, externalId=planId)
  └─ local JSON store → approved entry for local date
      └─ Telegram sendMessage → persist message receipt
```

The local JSON store is intentional for the hackathon demo and no-network fallback. Trigger.dev development schedules run only while its dev CLI is active and share `QUIMIGEN_DATA_DIR` with the bot. Cloud deployment requires replacing this adapter with a durable database; that is outside MVP.

## State machine

```text
CONFIGURING
  → AWAITING_SOURCE
  → GENERATING
  → APPROVED_SCHEDULED (automatic seal)
  → PAUSED
  → APPROVED_SCHEDULED
  → COMPLETED

A schedule provider failure leaves the validated queue in `DRAFT` with no active deliveries and a safe retry action.

Any content change:
DRAFT|APPROVED_SCHEDULED|PAUSED → DRAFT(version + 1, seal cleared)
```

Invalid transitions return a user-facing message and do not mutate provider state.

## Data contracts

A plan stores:

- `id`, `chatId`, `ownerUserId`, `createdAt`, `updatedAt`;
- `days`, `deliveryTime`, `timezone`, `startDate`;
- `source.kind`, `source.label`, `source.sha256`;
- `summary`, `objectives[]`, `researchSources[]`;
- `entries[]`: `id`, `day`, `scheduledDate`, `topic`, `objective`, `problem`, `hints[]`, `solution`, `sourceUrls[]`, `reviewRequired`;
- `version`, `queueHash`, `status`, `approvedAt`;
- `schedule.id`, `schedule.deduplicationKey`, `schedule.active`;
- `receipts[]`: local date, entry ID, Telegram message ID, sent timestamp.

No names, grades, school identifiers, or student profiles are stored.

## Idempotency and retry behavior

- Schedule dedupe key: `<environment>:<chatId>:<planId>`.
- Delivery key: `<planId>:<version>:<scheduledDate>:<entryId>`.
- A persisted receipt prevents a second send for the same delivery key.
- A stale run does not backfill missed entries.
- If Telegram returns an ambiguous network failure, mark the attempt uncertain and require operator reconciliation rather than retrying blindly.
- Provider errors never fall back silently; Telegram receives no unapproved replacement.

## Fixture mode

`QUIMIGEN_MODE=fixture` replaces OpenRouter and Exa with checked-in deterministic responses. Messages and logs display `DEMO FIXTURE`. Trigger schedule creation may be simulated only with `TRIGGER SIMULATED`; it must never be presented as live.

## Implementation slices

### Slice 1 — domain core and persistence

Expected files: `src/domain/*`, `src/store/*`, `fixtures/*`, domain/store tests.

- Validate commands and settings.
- Define plan/state contracts.
- Normalize/hash queues.
- Atomically persist local JSON.
- Select exactly one due approved entry.

Verification: `npm test`, `npm run typecheck`.

### Slice 2 — curriculum research and plan generation

Expected files: `src/providers/exa.ts`, `src/providers/openrouter.ts`, `src/curriculum/*`.

- Extract text/Markdown/PDF or public URL content.
- Generate a curriculum outline and bounded Exa queries.
- Generate schema-constrained plan output.
- Validate every URL and model response.
- Add deterministic fixtures and mocked-provider tests.

Verification: `npm test`, fixture CLI creates a valid draft.

### Slice 3 — guided Telegram conversation and automatic sealing

Expected files: `src/telegram/*`, `src/app.ts`.

- Long-poll Telegram without webhook deployment.
- Implement guided inline-button setup, command shortcuts, and pending intake state.
- Chunk complete queue previews safely and attach controls only to the final chunk.
- Enforce owner/chat authorization.
- Seal the exact queue version and create its schedule automatically after generation.

Verification: mocked Telegram update tests and fixture transcript.

### Slice 4 — Trigger.dev scheduling and delivery

Expected files: `trigger/*`, `trigger.config.ts`, `src/providers/trigger.ts`, delivery tests.

- Create/update one imperative daily schedule per plan.
- Pass only `planId` through `externalId`.
- Deliver one approved entry using scheduled payload local date/timezone.
- Store receipt before allowing another run.
- Pause/resume schedule with confirmation.

Verification: task import/build, mocked schedule API, duplicate/stale run tests.

### Slice 5 — operator path and demo hardening

Expected files: `.env.example`, scripts, README, demo fixtures.

- Document BotFather, Exa, OpenRouter, and Trigger.dev setup.
- Add health/config check and fixture demo commands.
- Test missing secrets, malformed files, bad URLs, provider timeout, duplicate run, stale run, pause, and exhausted queue.

Verification: `npm run verify` from a clean install.

## Explicit non-goals

- No Google Classroom, LMS, grading, student analytics, OCR, voice, payments, or multi-tenant admin UI.
- No autonomous web browsing outside Exa.
- No model-generated content at delivery time.
- No automatic outbound messages before the exact queue version has been validated, hashed, and automatically approved/sealed.
- No claim that plans improve grades or that generated problems are certified correct.
- No production cloud persistence in the MVP.

## Definition of done

- Tests cover the state machine, queue hash, authorization, automatic sealing, guided callbacks, safe schedule retry, schedule dedupe, duplicate delivery, stale run, and fixture flow.
- `npm run verify` passes.
- A real Telegram bot can ingest one supported source and preview a complete queue.
- With credentials, generation automatically creates a real Trigger.dev schedule for the sealed queue.
- A Trigger.dev test run sends one problem from the exact sealed queue and records its receipt.
- Fixture mode reproduces the flow with visible labels and no network.
- README distinguishes implemented, simulated, and future behavior.
