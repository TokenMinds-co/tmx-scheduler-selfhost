## Summary

<!-- What changes and why. PRs are squash-merged, so the title becomes the commit message — write it as one. -->

Closes #

## How I tested it

<!-- What you ran or clicked through. "pnpm test" alone is fine if that is what covers it. -->

## Checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass locally
- [ ] Schema change includes its migration under `backend/prisma/migrations/`
- [ ] README / docs updated where behaviour changed; line added under `[Unreleased]` in `CHANGELOG.md`
- [ ] No secrets, real addresses or customer data in fixtures or docs
