# Session handoff — 2026-10-06, Asia/Ho_Chi_Minh

## Objective and authorization

The user approved the 1990/Hallmark UI, real email/password sign-in, manual invite/recovery links and Admin/Staff/Viewer membership enforcement, then selected **Supabase local first; cloud later**. Continue the local implementation and verification. No cloud project or real Sheet mutation is part of this phase. Montserrat is the approved temporary font exception.

Read `AGENTS.md`, `.agents/PROJECT.md`, `.agents/PLAN.md`, `.agents/DECISIONS.md` and `docs/API.md`. Git/code are authoritative; historical MVP evidence in `docs/HANDOFF.md` is separate from this release.

## Git and source

- PR #6 passed CI at `33d25e8` and merged as `67f06ac`.
- Integration branch: `codex/pilot-ui-access`; draft PR #7: https://github.com/duytruong-lang/Verified-Lead-Call-App/pull/7.
- Original synchronized checkout has blocking reads of historical Git objects/refs and some source files. Preserve its `.git`, old worktrees and private configuration. The clean execution checkout is `/private/tmp/verified-call-pilot-repo`; isolated Luna worktrees are `/private/tmp/verified-call-pilot-backend` and `/private/tmp/verified-call-pilot-frontend`.
- Final source must be persisted to the original project with reversible backups before handoff. Do not delete/replace historical Git metadata to fix the blocked reads.
- Coordinator owns contracts, manifests/lockfiles and migrations. Luna implements; Sol independently reviews/QCs; Astra accepts after Sol. Check actual branch tips and uncommitted files on resume.

## Runtime and evidence in progress

Docker/Colima/Deno are installed. The first newly created empty VM failed with disk I/O when the host had only 1.1 GB free. After space was freed, that empty VM was rebuilt; no existing app database was reset. The current Supabase local stack is healthy at `http://127.0.0.1:54321` with project ID `verified-lead-call-local`. Colima mounts both the clean execution checkout and original project. Host free space remains limited; check it before downloads.

Eleven migrations are applied, including Viewer role, transactional membership and a follow-up serializing Sheet mapping writes with Admin revocation. Edge Functions are served from the execution checkout with ignored `.supabase/functions.env`; preserve its encryption keys. Local core services exclude Realtime, Studio, analytics and pooler to conserve resources.

Astra accepted local UI/Auth/access at `a02871f`, after Sol delta QC at `c9bb1dd`; application/backend source is identical between those commits. Final evidence: typecheck/lint/build, 46 Vitest tests, 17 demo Playwright tests, 117 actual local backend assertions, five frozen Deno entrypoint checks, four Deno helper tests and four actual Supabase browser flows passed. See `docs/PILOT-LOCAL-QC.md` for exact boundaries. Actual browser tests used a dependency symlink with font allowlist warnings; the separate demo visual suite verified loaded Montserrat and responsive layouts.

All tracked harness/browser fixtures were cleaned and their test memberships disabled, retaining Auth/profile/audit history. The requested first admin was bootstrapped locally with a random password stored in ignored `.supabase/local-admin-credentials.json` (`0600`). Ten synthetic pilot leads are present; a second seed run inserted zero and preserved all ten. Do not run the global harness on this populated pilot database.

## Bounded next actions

1. Open `docs/LOCAL-PILOT.md` for operator login/start commands and `docs/PILOT-LOCAL-QC.md` for accepted scope.
2. Keep the database and encryption keys. Resume local services without `db reset`; test recording with the operator's physical phone/microphone when ready.
3. Source/runtime persistence to the original checkout and PR #7 current-head CI are coordinator release steps; consult the final release note below rather than assuming they ran from this paragraph.
4. Cloud/real Sheet remain deferred. Obtain cloud capacity, staff email, service-account Sheet permissions and a physical-call operator before that separate phase.

## Private configuration and deferred work

Ignored `.supabase/functions.env`, `.supabase/backend-test-users.json`, `.supabase/local-admin-credentials.json`, `.env.supabase.local` and `.env.supabase.e2e` contain machine-specific configuration/credentials. Never print or commit their contents, raw invite/recovery links or recordings. Browser configuration contains only the anon key, never service role credentials.

The requested admin email is in the user conversation; do not hardcode it into fixtures/docs. Supabase rejected free cloud project creation due account quota, so no cloud project exists for this pilot. Railway was only discussed. Cloudflare deployment, real Google Sheet/Cron, a staff email and physical two-way phone recording remain deferred and unverified.
