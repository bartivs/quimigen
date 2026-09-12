# Demo runbook

## No-network fallback

```bash
npm run demo:flow
```

This executes curriculum extraction input, fixture research/model output, automatic immutable queue sealing, full queue preview, simulated Trigger schedule, one daily delivery, and receipt persistence. No manual approval is required. Every simulated component is labeled `DEMO FIXTURE` or `TRIGGER SIMULATED`.

## Live local demo

Prerequisites: BotFather token, Exa key, OpenRouter key, Trigger.dev project/key, and `pdftotext` for PDFs.

1. Copy `.env.example` to `.env` and set `QUIMIGEN_MODE=live`.
2. Set `QUIMIGEN_STATE_FILE` to the same absolute path in both processes.
3. Start `npm run trigger:dev` and wait for `quimigen-daily-delivery` to sync.
4. Start `npm run bot`.
5. In Telegram, send `/start` and tap **Crear un plan**.
6. Choose days, delivery time, and timezone with the inline buttons.
7. Send `fixtures/curriculum.md` or a public HTTPS curriculum URL.
8. Show objectives, Exa URLs, all three problems, and the automatic live schedule receipt.
9. On the Trigger task page, use **Test schedule** with the plan ID as `externalId` and a timestamp matching an entry date.
10. Show the Telegram delivery, then `/hint`, `/solution`, and tap **Pausar entregas**.

## 90-second narration

| Time | Visible action |
|---:|---|
| 0:00 | Tap **Crear un plan** and choose settings. |
| 0:15 | Send the curriculum in Telegram. |
| 0:35 | Show extracted objectives and cited Exa sources. |
| 0:50 | Show the complete immutable queue, already scheduled automatically. |
| 1:00 | Show Trigger.dev schedule, timezone, and external plan ID. |
| 1:15 | Run the scheduled task and receive one sealed problem. |
| 1:25 | Pause the plan with one tap; show that future sends are disabled. |

## Truth labels

- Do not call Trigger live when `schedule.simulated` is true.
- Do not call Exa/OpenRouter live in `QUIMIGEN_MODE=fixture`.
- The local JSON store is demo infrastructure, not production persistence.
- A Trigger cloud deployment cannot share that local file with the bot; use a durable database before cloud deployment.
