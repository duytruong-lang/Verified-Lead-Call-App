# Active execution state

## Summary

User approved implementation on 2026-10-06, then explicitly selected **Supabase local first; cloud later**. Deliver 1990/Hallmark UI polish, real email/password sign-in, manual invitation/recovery links, and server-enforced Admin/Staff/Viewer access in one workspace. Montserrat is the approved temporary font for all UI.

## Phases

1. Baseline: PR #6 current-head CI succeeded and PR merged as `67f06ac`.
2. Foundation: shared contracts, shadcn aliases/config and dependencies created.
3. Completed: Luna frontend/backend work integrated from isolated worktrees; coordinator owns contracts, manifests and migrations.
4. Completed: Sol independent review/QC and Astra local acceptance at `a02871f`. See `docs/PILOT-LOCAL-QC.md` for final checks.
5. Cloud and live Sheet pilot deferred by user; no deployment or real Sheet mutation now.

## Verification

Run typecheck, lint, Vitest, build, demo Playwright and local Supabase Auth/DB/Storage/Edge/browser flows. New tests must cover viewer/disabled access, invitation replay, role/status changes during claims/uploads, last-admin concurrency and keyboard/mobile UI. Preserve 5-attempt and pinned recording invariants.

## Risks

Original synchronized checkout has historical Git refs/objects blocking reads. Source has been copied back with backups. Use the durable clean checkout `.supabase/integration` for Git operations and preserve original history/private files. Local Docker/Colima/Deno are installed; the local stack is healthy with an admin and ten synthetic pilot leads. After cleanup, host free space is about 24 GB. Cloud project creation was rejected by Supabase free quota; no cloud pilot resource was created.

## What is needed later

Supabase cloud capacity and Cloudflare access, Google service-account permissions, staff email and physical-call operator. Cloud admin email was supplied privately; do not commit it into public fixture data.
