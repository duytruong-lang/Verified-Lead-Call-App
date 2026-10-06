# GitHub handoff — 2026-10-06, Asia/Ho_Chi_Minh

## Objective and authorization

The user approved the completed local UI/Auth/access pilot, then requested an official 1990 website logo/Montserrat update, removal of the idle-recorder sentence, a full GitHub handoff to `trieumanh0405`, and verified private backup followed by local Supabase cleanup. The recipient will provision their own Supabase account/project/secrets. No cloud project or real Google Sheet operation is authorized in this task.

GPT-6 Luna subagents implement and perform local operations. GPT-6.1 Sol independently reviews and performs final acceptance, superseding Astra for this handoff. Coordinator owns integration, shared contracts/manifests/migrations and evidence. No backend contract or schema change is required.

## Source and Git

Use the durable clean checkout `.supabase/integration` for Git; the original synchronized checkout has historical Git reads that can stall. Preserve the original `.git`, index and existing changes. Source was previously persisted with reversible backups under `.supabase/resume-backup-20261006-113916`. Never delete `.supabase` wholesale: it holds private configuration, the clean checkout, worktrees and recovery archives.

Integration branch `codex/pilot-ui-access`, PR #7: https://github.com/duytruong-lang/Verified-Lead-Call-App/pull/7. Base accepted application is `0ad0330`; official branding/UI and cloud handoff documentation are integrated at `155e317`. The final head must pass Sol review and CI before merge; confirm actual remote state when resuming.

## Verification and private runtime

The branding build passed typecheck, lint, 48 Vitest tests, build and all 17 demo Playwright tests. Responsive logo/header controls and font loading passed at 320/375/414/768px and desktop; actual local admin sign-in/logout, queue access, official logo and Montserrat loading passed without changing a lead. Existing backend acceptance remains 117 local assertions, four actual Supabase browser flows, five frozen Deno checks and four helper tests; these historical checks do not certify a cloud deployment.

Before retirement the local project is `verified-lead-call-local` in Colima `default`. Preserve its database, Storage and encryption keys until a full private backup and isolated restore have passed Sol verification. The last planning inventory had 10 synthetic leads, 61 Auth identities and no recordings/Storage objects; recount after freezing writes rather than assuming those counts. The populated pilot must not be reset or run through the global fixture harness.

Ignored `.supabase/functions.env`, `.supabase/local-admin-credentials.json`, `.supabase/backend-test-users.json`, `.env.supabase.local` and `.env.supabase.e2e` contain local-only secrets/configuration. Never print, commit or send them to the recipient. Backup/restore reports belong under ignored `.supabase/archives/`; procedures/evidence may also be under `.supabase/ops/`.

## Bounded next action

Verify the isolated documentation SQL checks and Sol review, publish through PR with successful CI, then complete the approved private backup/restore and scoped local cleanup.

## Recipient handoff

Start with `docs/HANDOFF-TRIEUMANH0405.md`; asset provenance is in `docs/BRAND-ASSETS.md`. GitHub currently has a pending write invitation for the recipient; inspect its state before making any access claim. The guide uses a fresh cloud database, new secrets and guarded Admin provisioning; local credentials are not migrated. Cloudflare, real Sheet/Cron and physical two-way audio remain unverified.

## Risks

1. Stop cleanup if backup/restore verification fails. Keep source/Git and archives outside all deletion targets.
2. Re-inventory Colima immediately before deletion. Delete its default VM/data only if it still has no unrelated workloads.
3. The repository is public: keep all credentials, recordings, real leads and runtime backups private.
