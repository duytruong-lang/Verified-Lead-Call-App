# GitHub handoff — 2026-10-06, Asia/Ho_Chi_Minh

## Objective and authorization

The user approved the final local UI/Auth/access pilot, then requested 1990 Agency branding, removal of the idle-recorder sentence, a GitHub handoff to `trieumanh0405`, and a verified private backup followed by local Supabase cleanup. The recipient will own and configure their own Supabase project and secrets. No cloud deployment or real Google Sheet operation is authorized by this handoff.

GPT-6 Luna implements and performs the approved local operations. GPT-6.1 Sol independently reviews, verifies the backup/restore before any cleanup, and accepts the handoff. The coordinator owns shared contracts, manifests, migrations, integration, and evidence. No backend API or schema change was made for the handoff.

## Source and GitHub status

- PR #7 merged the application handoff to `main` at publication SHA `8b9a538818e97f708b1e240a6612c1e1d72999e7`. This is the application release SHA; a later documentation-only PR can advance `main`.
- Main CI run `37423215470` succeeded.
- Sol accepted the integrated tree at `4bb2454`; its tree matches the merged `main` commit.
- A fresh remote clone completed `npm ci` and `npm run build` successfully.
- The merged source includes the official 1990 Agency logo, self-hosted Montserrat and its OFL license notice, the recorder copy change, and the recipient-owned Supabase handoff guide.

Preserve the original synchronized checkout and its Git history. The clean repository worktree `.supabase/integration` is the reliable checkout for Git operations. Do not delete `.supabase` wholesale: it contains private runtime files, worktrees, the clean checkout, and backup material.

## Verification evidence and boundary

The original local acceptance remains documented in [PILOT-LOCAL-QC.md](../docs/PILOT-LOCAL-QC.md). For this handoff, the bootstrap and smoke-lead SQL were tested against an isolated PostgreSQL database with the 11 repository migrations and scratch Auth/Storage shims. The bootstrap/seed behavior matrix passed, including seed concurrency, preservation of existing lead state, and ID/tag collision rejection. This is isolated SQL evidence, not a Supabase cloud deployment or production integration.

The cloud runbook is [HANDOFF-TRIEUMANH0405.md](../docs/HANDOFF-TRIEUMANH0405.md). It requires a fresh project owned by the recipient, new encryption secrets, disabled public signup, and explicit manual smoke tests. No real cloud project, live Sheet, Sheets Cron, Cloudflare Pages deployment, or physical two-way phone recording has been verified.

## Local project and private data

The local project was `verified-lead-call-local` in Colima `default`. Writes were frozen before backup. The pre-retirement inventory was 10 synthetic leads, one saved contact attempt, zero recordings, zero Storage objects, and 11 migrations. The self-contained private archive `.supabase/archives/20261006T132547+0700` now has 27 checksummed files, including `metadata/cleanup-result.txt`; hash and file-permission checks passed. Two cold-restore clones passed data, Auth/Admin, hashes, keys, and Storage checks, and Sol granted the formal `BACKUP_RESTORE_PASS` before deletion. Operations then confirmed Colima held only this project’s resources and the two restore clones, removed their containers/volumes/network, and deleted the `default` VM/data. Sol independently passed the final cleanup review, confirming VM absence, four stopped ports, and preservation of source/Git/configuration/archive.

Ignored files such as `.supabase/functions.env`, `.supabase/local-admin-credentials.json`, `.supabase/backend-test-users.json`, `.env.supabase.local`, and `.env.supabase.e2e` contain local-only credentials/configuration. Never print, commit, or give them to the recipient. Backup archives and restore evidence stay private under ignored `.supabase/` paths.

## Bounded next action

Scoped cleanup and Sol’s final independent check are complete. No Colima profiles or VMs remain, Docker is unavailable, and ports 5173, 54321, 54322, and 54323 are stopped. The source, original `.git`, `.supabase/integration`, and private archive remain. At the cleanup measurement snapshot, available host space increased from 14,192,832 KiB to 20,357,580 KiB, recovering 6,164,748 KiB (about 5.88 GiB / 6.31 GB); available disk space can change as other processes run. The retained archive occupies 1,134,016 KiB (about 1.08 GiB). Final backup/restore and retirement acceptance passed.

## Recipient handoff

At the latest access check, the GitHub write invitation for `trieumanh0405` was still pending. They must accept it, then create their own Supabase project, first Admin identity, encryption keys, and optional Sheet pilot. Do not send them credentials or messages from this task. The guide distinguishes local evidence from cloud steps that they must run and verify.

## Risks

1. Stop if backup validation or restore fails; retain the local project.
2. Recheck Docker/Colima resources before deletion and preserve any unrelated workload.
3. Keep credentials, recordings, real leads, and backups out of the public repository.
