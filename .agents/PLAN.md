# Active execution state

## Summary

Approved GitHub handoff to `trieumanh0405`: official 1990 logo/Montserrat, remove the idle-recorder sentence, recipient-owned Supabase runbook, merge through PR, then verified private backup and local Supabase cleanup. No new backend API/schema or cloud deployment.

## Phases

1. Luna UI and documentation work in separate worktrees; coordinator integrates and owns shared manifests/contracts/migrations.
2. Sol independently reviews brand, recorder behavior, own-account cloud bootstrap, and public-source safety.
3. CI must pass the final PR head, then merge and verify main CI/clean checkout.
4. Luna operations creates a private full backup and isolated restore; Sol must verify it before deletion.
5. Remove only project runtime; remove Colima default VM/data only after confirming no unrelated resources. Preserve source, Git and backup. Record actual recovered disk space.

## Verification

Typecheck/lint/unit/build/demo browser suite; visual checks at 320/375/414/768px and desktop with loaded fonts/logo; actual local sign-in smoke without running the global harness on the populated pilot. Validate first-admin SQL on isolated data, backup all schemas/Auth/roles/Storage/migration history and encryption keys, verify restore counts and membership consistency. CI and public-source review are required before main publication.

## Risks

Original synchronized Git metadata has historical blocking reads: use `.supabase/integration` and preserve the original history/index. `.supabase` also contains private runtime files and the clean checkout, so never delete it wholesale. Stop cleanup on any failed backup/restore check or unexpected shared resource.

## What is needed later

Recipient accepts GitHub write invitation and provisions their own Supabase/Cloudflare credentials, Admin email and optional Sheet pilot/service account. Existing local evidence does not certify that future deployment.
