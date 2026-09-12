# Demo runbook

## No-network fallback

```bash
npm run demo:flow
```

This executes curriculum extraction input, fixture research/model output, full queue preview, explicit approval, simulated Trigger schedule, one daily delivery, and receipt persistence. Every simulated component is labeled `DEMO FIXTURE` or `TRIGGER SIMULATED`.

## Live local demo

Prerequisites: BotFather token, Exa key, OpenRouter key, Trigger.dev project/key, and `pdftotext` for PDFs.

1. Copy `.env.example` to `.env` and set `QUIMIGEN_MODE=live`.
2. Set `QUIMIGEN_STATE_FILE` to the same absolute path in both processes.
3. Start `npm run trigger:dev` and wait for `quimigen-daily-delivery` to sync.
4. Start `npm run bot`.
5. In Telegram, send `/plan 3 18:00 America/Asuncion`.
6. Send `fixtures/curriculum.md` or a public HTTPS curriculum URL.
7. Show objectives, Exa URLs, summary, and all three problems.
8. Send the exact `/approve <planId> <version>` command printed by the bot.
9. Show the live Trigger schedule receipt.
10. On the Trigger task page, use **Test schedule** with the plan ID as `externalId` and a timestamp matching an entry date.
11. Show the Telegram delivery, then `/hint`, `/solution`, and `/pause`.

## 90-second narration

| Time | Visible action |
|---:|---|
| 0:00 | Send curriculum and plan settings in Telegram. |
| 0:15 | Show extracted objectives and cited Exa sources. |
| 0:35 | Show summary and complete, immutable problem queue. |
| 0:50 | Approve the exact plan/version. |
| 1:00 | Show Trigger.dev schedule, timezone, and external plan ID. |
| 1:15 | Run the scheduled task and receive one approved problem. |
| 1:25 | Pause the plan; show that future sends are disabled. |

## Truth labels

- Do not call Trigger live when `schedule.simulated` is true.
- Do not call Exa/OpenRouter live in `QUIMIGEN_MODE=fixture`.
- The local JSON store is demo infrastructure, not production persistence.
- A Trigger cloud deployment cannot share that local file with the bot; use a durable database before cloud deployment.
