# Project knowledge — Verified Lead Call App

## Read first

Read `AGENTS.md` → `.agents/HANDOFF.md` → `.agents/PLAN.md`. Code and Git are the source of truth; this directory records context and intent. Validate the handoff against the current checkout before editing. Product acceptance is in `docs/HANDOFF.md`; cross-session state is in `.agents/HANDOFF.md`.

## Product and user context

- Repository: https://github.com/duytruong-lang/Verified-Lead-Call-App
- Vietnamese in-house call center; optimize for a simple operator workflow.
- Existing ad-platform pipelines continue writing incoming leads to a Google Sheet. App imports leads, owns call history/evaluation in PostgreSQL, and exports results asynchronously.
- Workflow: choose lead → claim attempt → record PC mic or upload audio → call physical phone on speaker → stop/listen → outcome/note → save & next.
- There is no automatic SIM calling or phone interception. PC microphone quality for both sides still needs a physical-call pilot.
- Original reference UI was Vocaroo. Approved scope is a lead workspace with a simple recorder, not a Vocaroo clone.
- Approved MVP excludes Zalo notification, CRM, assignment, reminders/SLA, customer approval portal, and AI scoring.
- User approved the local UI/Auth/access implementation, then a GitHub handoff to `trieumanh0405`: official website branding, merge through PR, verified private backup and removal of this project’s local Supabase/Colima runtime. The recipient will provision their own Supabase project; no cloud or real Sheet mutation is authorized here.
- Original Sheet reference was `RAW-DATA-CALL-CENTER`. Its current contents, permissions and automations have not been validated by this final local acceptance. Keep real Sheet IDs/data outside this public memory; use a separately authorized pilot copy.

## Architecture and navigation

| Area | Implementation / documentation |
| --- | --- |
| Frontend | React 19, Vite 7, TypeScript, Tailwind CSS; `src/App.tsx`, `src/style.css` |
| Recorder | Browser `getUserMedia` / `MediaRecorder`, browser decode validation; `src/App.tsx` |
| Mode boundary | `src/adapters/createRepository.ts`, `demo.ts`, `supabase.ts`; explicit mode, no silent fallback |
| Shared contract | `src/shared/types.ts`, `repository.ts`, `rules.ts`; `docs/API.md` |
| Database | Supabase Auth/PostgreSQL/RLS/RPC; baseline migrations `202610060001`–`202610060008` plus additive pilot membership migrations; `docs/BACKEND.md` |
| Recording/backend | Private Storage; `call-api`, `public-recording`, shared `media.ts`/`crypto.ts` |
| Sheet admin UI | `src/components/SheetMappingAdmin.tsx` |
| Sheet core | `src/integrations/sheets/`; `sheets-admin`, `sheets-worker`; `docs/SHEETS.md` |
| Cron/hosting | `supabase/cron/sheets-worker.sql` example, Cloudflare Pages SPA `_redirects`; not deployed/activated on cloud |
| Checks | Vitest, Playwright demo `e2e/smoke.spec.ts`, opt-in Supabase browser `e2e/supabase/`, backend harness `scripts/local-backend-check.mjs`, GitHub Actions |
| Operations | `docs/OPERATIONS.md`, `BACKEND.md`, `FRONTEND.md`; original requirements `docs/PLAN.md` |

## Critical behavior already implemented

The original baseline and new UI/auth/member scope are accepted locally; use `.agents/HANDOFF.md` and `docs/PILOT-LOCAL-QC.md` for release-specific evidence. Membership is one workspace, roles Admin/Staff/Viewer, statuses pending/active/disabled, manual invite/recovery links and access disable that retains historical attribution and public recording shares. Cloud/real Sheet/physical audio remain unverified.

- Four queues, oldest-first defaults, periodic/focus refresh while preserving drafts.
- At most five completed contact attempts. Re-recording, uploads and retry do not increment the count; final evaluation after the fifth remains available.
- Eight outcomes are defined in `AGENTS.md`; notes are optional except `other`. No answer uses `unreachable`.
- One exclusive 15-minute claim; heartbeat renews it every five minutes. Resume/cancel are explicit. Atomic outcome save optionally includes evaluation and advances UI only after persistence/audio succeeds.
- Lost-response save retains the same payload/idempotency key and locks edits. Clip changes create a new upload identity. Expired upload URLs renew the existing target. Cancel/navigation stops microphone tracks and ignores stale callbacks.
- Verified requires ready, playable audio owned by that lead and an active share. Server validates actual bytes/MIME/duration; limits are 30 minutes and 50 MB.
- Immutable recording objects and pinned `/r/:token` links; explicit audited handoff replacement. Old links keep their old recording until separately revoked.
- Public page reveals only recording metadata/player/download; five-minute signed playback URL. Revoke blocks new grants, not a URL already issued before expiry.
- Demo uses localStorage + IndexedDB in one browser profile. Demo links cannot be handed to a different browser/person. Production build rejects demo mode.
- Sheet identity uses app UUID and row/column developer metadata, not phone/platform ID/row index. Duplicate IDs or ambiguous mapping persistently fence output; admin repair requires unique readback and audit.
- Formula/unmapped cells are preserved. Exact Sheet labels, date/timezone conversion, latest operator note, and cleared stale link for Unverified are handled.
- Database call history is authoritative after import. Imported legacy Verified/links remain separate source metadata, not proof of a valid private recording.
- Worker uses global lease, cursor CAS, per-lead version/fencing and durable outbox. Expired/ambiguous writes are quarantined for reconciliation, never blindly retried. Re-read actual row UUID immediately before writing; mismatch produces zero writes.
- New lead discovery follows populated rows, not the spreadsheet grid tail. Output/provisioning has bounded budgets.

## Private configuration boundary

Ignored local files: `.supabase/functions.env`, `.supabase/backend-test-users.json`, `.env.supabase.e2e`. They may exist on this machine; they are not supplied by GitHub. Never print/commit their contents. Keep `SHARE_ENCRYPTION_KEY` stable across restarts. Cloud secrets/service account credentials must be provisioned separately. Do not put service role credentials in frontend/Cloudflare Pages variables.

## Working agreement

GPT-6 Luna subagents implement/fix/test/document and perform approved local operations; GPT-6.1 Sol independently reviews, QCs and accepts the final handoff. Root coordinates contracts/integration/evidence. Use requested model identifiers from `AGENTS.md`, maximum four active including coordinator, separate worktrees for parallel tasks. Do not replace models silently. Do not push directly to `main`; integration requires CI and Sol review. Read actual status first rather than relying on an old chat, stale process IDs, or this snapshot alone.
