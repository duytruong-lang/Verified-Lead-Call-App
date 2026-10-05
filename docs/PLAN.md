# Verified Lead Call App — implementation plan

## Summary

A single-screen staff app for selecting a lead, recording a phone conversation through the PC microphone while calling on a physical phone, saving an outcome, and handing off a stable recording link. Google Sheets remains the source of incoming leads and receives asynchronous results. PostgreSQL is the business record and Supabase private Storage holds audio.

MVP includes the first verification round (up to five attempts), staff sign-in, lead queue/history, mic recording or audio upload, outcome recording, configurable admin Sheet mapping, and a public recording-only listen/download page. It excludes CRM, automatic assignment, SLA/reminders, an approval portal, AI scoring, and SIM calling.

## Business behavior

- Staff see queues for Not called, In progress, Callback, and Finished, with lead details, history, and attempt count.
- Outcomes: Có quan tâm (`interested`), Thuê bao/máy bận (`unreachable`, including no answer), Gọi lại sau (`callback`), Cúp máy ngang (`hung_up`), Không có nhu cầu (`not_interested`), Spam/Phá máy (`spam`), Sai Số (`wrong_number`), Khác (`other`, note required).
- Only a newly saved contact outcome increments attempts. Recording again, uploading again, and retries do not. Attempt six is blocked, while final evaluation remains available.
- “Save & next” advances after app persistence and successful audio attachment; it does not wait for Sheet output. An incomplete session can be resumed or canceled. Conflicting staff claims cannot complete the same attempt twice.
- Verified requires a playable ready recording for that lead and an active share link.

## Recording and sharing

- Audio is stored in private Supabase Storage. Default limits are 30 minutes or 50 MB per recording.
- Sheet output stores a stable app listen-page link, never an expiring signed URL.
- Each link is fixed to one recording. Replacing the handoff is explicit and records old/new versions, actor, and timestamp.
- `/r/:token` shows only a recording code, recorded time, duration, and player/download control. The server validates the token and returns a five-minute signed audio URL.
- Owner/admin can revoke a link. Already issued playback access can remain valid until expiry. No automatic file deletion is planned.
- Unfinished, empty, invalid-format, or unplayable recordings cannot be handed off.

## Sheet mapping and synchronization

One source spreadsheet/tab, one lead per row. Mapping is role-based and supports required phone, system-managed stable ID, optional name/source/created date/email/form answers, five outcome/time pairs, evaluation/note/time/recording link. Duplicate headers are disambiguated by role and column identity. Formula and unmapped columns are preserved.

Mapping must be revalidated after schema changes. If a column cannot be resolved confidently, stop Sheet writes, alert admin, and retain app data. A worker polls about every 60 seconds and uses durable idempotent sync jobs and versions so stale jobs cannot replace newer links.

## Architecture and tools

- Frontend: React, Vite, TypeScript, Tailwind CSS; browser `getUserMedia` and `MediaRecorder`.
- Backend: Supabase Auth, PostgreSQL, private Storage, Edge Functions, and Cron.
- Sync: Google Sheets API with retry and reconciliation.
- Hosting: Cloudflare Pages.
- Checks: Vitest, Playwright, GitHub Actions.

The app has explicit live and demo adapters. Demo mode is opt-in and cannot be a production silent fallback. Shared data contracts are in `src/shared/` and `docs/API.md`.

## Phases

1. **Foundation:** preserve the existing repository history; establish docs, contracts, bootstrap, sample data, CI, and a local Sheet pilot template. Sol reviews the foundation before parallel implementation.
2. **Implementation:** Luna backend owns schema/auth/authorization/storage/recording/sharing; Luna frontend owns call center/recorder/outcome/public player; Luna Sheets owns mapping/import/export/retry/reconciliation. Backend contract, manifest, and migrations have one owner. Frontend can use the contract and synthetic fixture before live backend integration.
3. **Review/QC:** Sol independently reviews each integration and the combined app. Luna fixes findings; Sol retests. Record commit SHA, actual checks, results, and unverified items.
4. **Acceptance/handoff:** Astra checks the accepted build against all criteria and exercises staff and customer flows. Findings return to Luna and pass Sol QC before reassessment. Record release SHA, app/GitHub links, operator/admin instructions, error handling, rollback, and limits in `docs/HANDOFF.md`.

## Acceptance checks

- Typecheck, lint, build, business tests, and browser flow.
- Record/upload → save outcome → asynchronous Sheet update → customer opens link to listen/download.
- Block Verified without a valid recording; block attempt six; retry and double click do not increment attempts.
- Concurrent staff cannot duplicate completion. Sort/insert rows, duplicate phone, missing platform ID, duplicate headers, and changed schema never bind the wrong lead/column.
- Upload/Sheet errors retain saved app state. Existing links retain their recording; replacement is audited. Stale jobs cannot overwrite current handoff. Revocation prevents new signed access.
- Preserve formulas and expected Verified output after migration.

Do not label a check passed unless it ran. Separate local/mock evidence from real integrations.

## Risks and open rollout inputs

Test real calls on speakerphone for two-way audio. Recording/upload requires the browser tab open and the machine awake. Review storage/playback quotas and retention before broad rollout. Pilot with one staff member and a copy of the Sheet, after checking existing automations. Before production connection, obtain admin/staff emails, cloud accounts, confirmation of pilot vs production Sheet, and permission to inspect existing automations. Proposed defaults: show Not called first, older leads first, staff choose leads, no scheduled callback reminders or SLA.
