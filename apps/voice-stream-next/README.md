# Voice Stream Next

Voice Stream Next is the planned parallel voice and assistant product for Drone. It is intentionally separate from the current `apps/voice-stream` implementation so the existing Android voice, desktop voice, assistant side panel, and Drone Hub workflow can keep working while the new product is designed and built.

This directory starts as documentation only. It should not affect the current monorepo build, Hub launch flow, or Android APK.

Internal monorepo name: `voice-stream-next`.

User-facing product name: Voice Stream.

## Goal

Build a standalone voice product with:

- an Android voice client
- an Electron desktop voice client
- a Vite web dashboard
- a Fastify backend
- assistant threads and settings
- Clerk login on Android and desktop
- per-user profiles
- starter SQLite persistence in the server data directory
- a clean protocol between clients and the service
- no required Drone Hub integration during the first development phase

Drone Hub integration should come later through explicit adapters, after the new product reaches enough feature parity to replace or coexist with the current voice stack.

## Current Baseline

The existing working system remains:

```text
apps/voice-stream       # current Android app and voice server
apps/drone              # current Hub API, assistant runtime, desktop voice service
apps/drone-hub          # current React UI and assistant side panel
```

Voice Stream Next should not import implementation code from `apps/voice-stream` directly. Code that is truly shared should move into stable `packages/*` modules or shared test fixtures.

## Docs

- [Product Spec](docs/product-spec.md)
- [Architecture](docs/architecture.md)
- [Parity And Migration Plan](docs/parity-and-migration.md)
- [Open Questions](docs/open-questions.md)
