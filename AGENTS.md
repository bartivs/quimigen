# QuimiGen contributor rules

- Preserve the approval invariant in `docs/BUILD_PLAN.md`: scheduled tasks may send only content from the exact approved queue version.
- Never commit tokens, curriculum uploads, chat IDs, personal data, or generated user plans.
- Keep fixture and simulated behavior visibly labeled.
- Use atomic commits and run `npm run verify` before every implementation commit.
- Keep the MVP local-first; production persistence and LMS integrations are non-goals.
