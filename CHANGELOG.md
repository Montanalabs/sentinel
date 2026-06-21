# Changelog

All notable changes to Sentinel are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- CLI (`sentinel init` / `start` / `keygen` / `verify`) for self-hosting.
- SQLite provenance store backend (`node:sqlite`, no separate server) alongside in-memory and Postgres.
- Sidecar request `bodyLimit`, default backpressure, and per-sub-request rate limiting on `/v1/guard/batch`.
- Bounded-memory `/v1/verify` and `/v1/analytics` (paged), and `nextOffset` paging on `/v1/export`.
- Key-rotation support for `/v1/verify` via `SENTINEL_TRUSTED_KEY_IDS`.

### Changed

- Provenance verification now pins to trusted signer key id(s); `signerPublicKey` is bound by the
  content hash. **This changes the record content-hash format — chains signed by earlier builds do
  not verify under this version.**
- Engine fails safe on a throwing/late check and on a policy that resolves to no runnable checks
  (ESCALATE, never silent ALLOW).
- Policy DSL numeric comparisons coerce decimal strings consistently across all operators.

### Security

- Hardened the agent SDK (validates and bounds the sidecar response; fails closed on malformed).
- Redacted store-URL credentials from errors; non-root Docker runtime; safe numeric env parsing.

## [0.1.0]

- Initial release: SDK + sidecar + verdict engine, signed hash-chained provenance, fintech and
  healthcare policy packs, cross-model second opinion (Anthropic/OpenAI/mock).
