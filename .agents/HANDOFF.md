# Session handoff — 2026-10-06, Asia/Ho_Chi_Minh

## Start here

Read `AGENTS.md`, this file, `.agents/PROJECT.md`, `.agents/PLAN.md`, `.agents/DECISIONS.md`, then `docs/HANDOFF.md`. Compare `git status`, log, current branch and PR status before acting. The user explicitly requested saving all project knowledge to the local folder and GitHub for another session/agent. This is a documentation handoff, not authorization to begin new implementation or connect real data.

## Current Git and milestone

- Repository: https://github.com/duytruong-lang/Verified-Lead-Call-App
- Primary workspace: `/Users/duy.truong/Documents/Shared/1.Docs/Coding Projects/Verified Call App`.
- Local branch: `codex/continuity`, tracking remote `origin/codex/handoff`; it contains the accepted documentation and this continuity update. Use `git rev-parse HEAD` for the exact handoff commit (a document cannot embed its own commit hash).
- App on `main`: `35de0ed61f1a7cee3440d1ced444ff76d6af4ed1`. Its tree was independently compared and is identical to accepted code `2e24bba024975c3488c6b26dd5f67e07cb9e3f47`.
- Documentation baseline before this update: `ef2da95073cf3a6b01f040570668ed2c34dd036f`; Sol approved those docs. Current update changes memory/docs only and must not be described as a new app build.
- PRs #1–5 merged. PR #6: https://github.com/duytruong-lang/Verified-Lead-Call-App/pull/6 — acceptance/docs/continuity, currently open. It is the publication vehicle; do not create another duplicate PR.
- Main CI run `37363192195` passed for `35de0ed`. PR #6 run `37363730003` on `ef2da950` failed without executing any steps: annotation **“The job was not acquired by Runner of type hosted even after multiple attempts”**; job concluded cancelled. This is a runner allocation failure, not a demonstrated code/test failure. The older superseded run `37363373324` was cancelled. Check the new PR-head run after this docs push; do not assume the old result applies or bypass the gate.
- No app files were edited for this handoff. Prior accepted app implementation/local QC is complete; remaining release work is documentation CI/merge and eventual separately authorized pilot.
- Sol independently reviewed this continuity update on 2026-10-06: **PASS**, no content blockers. Git/tree/PR consistency, documentation-only scope and local/live evidence boundaries were checked. Coordinator checked local Markdown links, whitespace and ignored-private-file exclusion. No application suites were rerun for this memory-only update.

## Completed verification (historical evidence)

Sol's integrated gate at `2e24bba`: typecheck, lint, build, **45 Vitest unit tests**, **11 demo Playwright tests**, real local Supabase Auth/PostgreSQL/RPC/private Storage/Edge harness, real local Supabase browser flow, admin/role checks, adverse fake-Google identity test with zero writes, and frozen Deno checks of all four Edge entrypoints passed. See `docs/HANDOFF.md` for attribution and scope; do not invent harness assertion totals.

Astra directly reran local Supabase Playwright **1/1 passed**, reviewed requirements/docs and inspected staff UI, then accepted **local-first** only. Sol additionally ran that local browser flow from primary `main` with the npm-lock Supabase SDK **2.117.2**, **1/1 passed**. This resolved a different dependency tree in the Sheets worktree caused by Deno automatic node_modules handling; avoid invoking Deno auto-node_modules in the primary checkout if preserving the npm install is required.

Actual local browser coverage: staff login → fake microphone recording → private upload → Verified save → anonymous playback with time advancing → nonempty download → revoke → fresh anonymous access denied. Tests use synthetic data and clean up their own lead/audio.

Google HTTP/mapping/outbox tests use fake transport. No live Google Sheet, Supabase cloud, Cloudflare deployment, actual cloud Cron, production configuration or physical-phone capture has been verified. Do not report these as passed.

## Local runtime snapshot (verify again on resume)

- Demo: `http://127.0.0.1:5174/`; returned HTTP 200 when handoff inspection ran. Vite process is in the primary workspace. Command: `npm run dev:demo -- --host 127.0.0.1 --port 5174 --strictPort`.
- Supabase local: project `verified-lead-call-local`, API `http://127.0.0.1:54321`, DB port 54322. Docker/Colima core containers were running; DB/Auth/Storage reported healthy. Existing local stack has accepted migrations; do not reset it to merely resume.
- Edge Functions are currently served from `/Users/duy.truong/.codex/worktrees/call-sheets/Verified Call App`, using `npx supabase functions serve --env-file .supabase/functions.env`. Source provenance matters when switching branches. No worker configured for a real Google Sheet/Cron.
- Ignored private files in the primary folder: `.supabase/functions.env`, `.supabase/backend-test-users.json`, `.env.supabase.e2e`. Equivalent Edge/test files exist in the Sheets checkout. Never print or commit them; they are not part of GitHub. Keep the existing `SHARE_ENCRYPTION_KEY` stable. Credentials must be provisioned separately on another machine.
- Demo audio/lead state lives in the browser profile, not GitHub/database; links are same-profile only. Processes and these local files may be unavailable after restart or on another machine.

## Worktrees (preserve, do not clean up automatically)

| Path | Branch / role |
| --- | --- |
| Primary workspace above | `codex/continuity` → remote `codex/handoff`; complete local knowledge |
| `/Users/duy.truong/.codex/worktrees/call-backend/Verified Call App` | `codex/backend`; backend implementation history |
| `/Users/duy.truong/.codex/worktrees/call-frontend/Verified Call App` | `codex/frontend`; frontend history |
| `/Users/duy.truong/.codex/worktrees/call-sheets/Verified Call App` | `codex/handoff`; docs/Sheets and active local Edge source |

Check `git worktree list`/status for current hashes. No active subagent work is required to resume; old implementation, Sol and Astra tasks finished. Follow model roles/max-four policy in `AGENTS.md` for any newly authorized work.

## Commands and files to reuse

```sh
git status --short --branch
git log -5 --oneline
gh pr view 6 --json state,headRefOid,statusCheckRollup,url
```

For a new clone: `npm ci`, then `npm run dev:demo` for synthetic demo. For already configured loopback tests: `node scripts/local-backend-check.mjs`, `node scripts/prepare-supabase-e2e-env.mjs`, `npx playwright test --config=playwright.supabase.config.ts`. Foundation checks: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e`. Do not run them against real-data environments. Full stack setup/rollback are in `docs/OPERATIONS.md` and `docs/BACKEND.md`; setup's `db reset` is destructive and unnecessary for the existing stack.

## Remaining work and gates

1. Check current PR #6 CI after continuity push; if runner allocation fails again, rerun failed CI and record the external blocker honestly.
2. Merge only after current-head CI succeeds and documentation review is complete; fast-forward primary folder to merged `main` without discarding any work. Update this state if circumstances change.
3. Product next stage is separately authorized one-person pilot with a Sheet copy and cloud accounts; user inputs are listed in `.agents/PLAN.md`. No app implementation task remains within the completed local MVP.

## Risks (three)

1. CI runner allocation can prevent docs merge even though accepted app `main` CI passed; do not bypass it.
2. Runtime/private config is machine-specific; preserve encryption key and local data, never reset/stash/delete to resume by habit.
3. Cloud, real Google output and actual two-way phone recording are unverified; local acceptance is not production readiness.

## Exact next action

Check PR #6 CI on the current HEAD before integrating the documentation into `main`.
