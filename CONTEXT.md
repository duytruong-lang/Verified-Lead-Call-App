# Project context

## Glossary

- **Lead:** one source Sheet record mirrored into the app with a stable internal UUID.
- **Attempt:** one saved contact outcome; at most five per lead in the first verification round.
- **Recording:** validated audio in private Supabase Storage, attached to one lead/attempt.
- **Handoff recording:** the explicitly selected recording shared with the customer for acceptance.
- **Share link:** durable app URL with a revocable opaque token pinned to one recording; audio access is short-lived and signed by the server.
- **Sheet mapping:** admin configuration connecting source/target roles to stable column metadata in one spreadsheet tab.
- **Sync job:** durable, retryable import/export operation. The app database remains authoritative for workflow state.
- **Demo adapter:** synthetic local data selected explicitly for development; never a production fallback.

## Roles

Implementation is assigned to GPT-6 Luna, independent review/QC to GPT-6.1 Sol, and final acceptance/handoff to GPT-6 Astra. The coordinator owns shared types, the manifest, and migrations.

## Current state

Phase 0 foundation. No real Supabase project, Google Sheet, Cloudflare account, or credentials are configured. Local checks validate the scaffold only.
