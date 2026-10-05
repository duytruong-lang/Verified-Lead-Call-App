# Phase 1 handoff draft — acceptance pending

This is an implementation handoff draft. Do not treat it as release approval. Sol frontend QC passed commit `2a22ee7` and the root coordinator merged that reviewed frontend fix. Astra acceptance and final integrated release SHA are still pending; backend/Sheets changes continue independently.

## Delivered in the frontend branch

- Vietnamese operator screen with the four queues, form details, claim/resume/cancel, heartbeat, notes, all eight outcomes, attempt history and final evaluation.
- Microphone/file recording, browser decode checks and limits, private upload adapter, verified share handoff, replacement/revoke UI, and minimal public recording page.
- Explicit local demo with synthetic data and persistent browser-only audio; separate live Supabase adapter with no silent demo fallback.
- Admin mapping/status/reconcile UI, responsive styles, user guide and SPA route fallback for Pages.
- Playwright demo regression tests and CI Chromium job. A separate loopback-only Supabase browser test exercises signed staff and anonymous public access.

## Evidence

The frontend fix `2a22ee7` passed typecheck, lint, Vitest (3 tests), production build, demo Playwright (9 tests), and Sol's independent frontend retest. Its build reported the Vite bundle-size advisory above 500 kB.

The Supabase local test was run once against the active synthetic local stack and completed staff login, fake-microphone capture, upload, verified save, public playback/download, and revoke. The test has since been hardened to use a fresh anonymous browser context, assert media readiness/playback progress/nonempty download, and prove revoked access is denied; rerun that exact hardened test after the current additive backend migration window before marking the evidence complete.

Not verified: real Google Sheets access or writes, Cloudflare Pages deployment, production auth/storage policies, physical phone speaker capture, production recording retention, or Astra acceptance. Local-stack results must not be described as cloud integration evidence.

## Runbook and rollback

See [docs/OPERATIONS.md](OPERATIONS.md) for demo/local Supabase commands, operator steps, admin mapping, recovery behavior, Pages rollout, and rollback. Local `db reset` is destructive and belongs only to the disposable loopback project. Production rollback must coordinate compatible frontend/backend versions; do not reset a cloud database.

## Acceptance gate

Keep status pending until Sol has retested the final integrated SHA, Astra records acceptance evidence, the hardened local Supabase browser flow passes on integrated backend code, and release/environment/rollback owners are recorded. Then replace this draft status with the final SHA and exact evidence without adding credentials or real lead details.
