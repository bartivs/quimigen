# QuimiGen

Telegram agent that turns a curriculum file or public URL into a cited, reviewable study plan and uses Trigger.dev to deliver one approved problem per day.

## Status

MVP implementation in progress. See [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) for the exact scope, approval invariant, architecture, and acceptance criteria.

The key safety rule is fixed: **scheduled jobs deliver only immutable problems that the user already approved; they never generate new outbound content.**
