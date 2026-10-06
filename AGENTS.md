# Agent roles and project rules

## Cross-session continuity

Before resuming, read `.agents/HANDOFF.md`, `.agents/PROJECT.md`, `.agents/PLAN.md`, and `.agents/DECISIONS.md`; validate them against current Git/code. `docs/HANDOFF.md` records product acceptance, while `.agents/HANDOFF.md` records session state and the bounded next action. Never treat historical local/mock evidence as proof of live cloud/Sheet operation.

## Product scope

Build a lead verification call workspace. Staff choose a lead imported from one configured Google Sheet, call using a physical phone on speaker, record PC microphone audio, save one of the defined outcomes, and hand off a playable recording link when verified. The app database is the business record; Sheets is an asynchronous input/output surface.

## Roles

- **GPT-6 Luna (`gpt-6-luna`) — implementation:** owns implementation, migrations, tests, docs, and fixes.
- **GPT-6.1 Sol (`gpt-6.1-sol`) — independent review and QC:** review each integration and report findings against the plan.
- **GPT-6 Astra (`gpt-6-astra`) — acceptance and handoff:** evaluate the integrated build after Sol QC and record acceptance evidence.
- **Coordinator:** owns shared contracts, manifest, lockfile, migrations, integration order, and evidence tracking. Do not overlap ownership of these files; send requested changes to the coordinator.

Use separate branches/worktrees for parallel tasks. Do not push directly to `main`. Do not commit credentials, real lead data, recordings, or production configuration. Do not connect or mutate a real Sheet or cloud project without explicit authorization. Keep demo data synthetic and demo mode opt-in.

## Architecture

- React, Vite, TypeScript, Tailwind CSS.
- Supabase Auth, PostgreSQL, private Storage, Edge Functions, and Cron.
- Cloudflare Pages for hosting; Google Sheets API for asynchronous synchronization.
- Vitest for unit tests, Playwright for browser checks, GitHub Actions for CI.
- `src/shared/` owns frontend/backend contracts. See `docs/API.md` before changing them.
- Live Supabase access and demo access must be selected explicitly; production never silently falls back to demo data.

## Business invariants

- A lead has at most five completed contact attempts. Only saving a new contact outcome increments the count; re-recording, re-uploading, and retrying do not.
- Outcomes: `interested`, `unreachable`, `callback`, `hung_up`, `not_interested`, `spam`, `wrong_number`, `other`. `other` requires a note. No answer belongs to `unreachable` (label: “Thuê bao/máy bận”).
- Verified requires a ready, playable recording belonging to the lead and an active share link. Empty, invalid, incomplete, or unplayable audio cannot be handed off.
- Maximum audio is 30 minutes or 50 MB. Storage is private; a public `/r/:token` page identifies only the recording. Playback uses a five-minute signed URL.
- Each share link stays pinned to one recording. Replacing the handoff recording is explicit, versioned, and audited.
- A lead can have only one active work claim/completion for a given attempt. Retried sync jobs are idempotent and stale jobs cannot overwrite newer handoff links.
- Google Sheet mapping is admin-only. Phone is required; mapping changes that cannot be resolved safely stop Sheet writes. Preserve formulas and unmapped columns.
- Poll Sheets about every 60 seconds. Persist app state before asynchronous Sheet output.

## Verification

Foundation commands: `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`. Run applicable checks after changes and report failures or unverified integrations plainly. Playwright browser verification is required for completed end-to-end flows; do not claim a live Supabase, Google Sheets, or Cloudflare integration from local mocks.
