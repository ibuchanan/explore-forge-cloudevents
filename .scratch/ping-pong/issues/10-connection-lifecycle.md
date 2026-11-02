# 10: Complete connection lifecycle

**What to build:** An installation begins with empty local configuration, preserves saved connections across repeated setup or upgrades, and attempts local cleanup on pre-uninstall without affecting peers.

**Blocked by:** 02: Manage peer connections.

**Status:** completed locally (2026-11-02; not deployed)

- [x] Initialize only if storage is absent; repeated initialization and upgrades preserve existing records. Missing storage reads as empty, whereas failed reads or malformed data remain sanitized errors and are not overwritten.
- [x] Pre-uninstall attempts best-effort deletion of local connection data, logs sanitized failures, and does not promise guaranteed deletion, contact peers, or delete the environment-level RPC secret.
- [x] Tests exercise first/repeated initialization, preservation, failed storage reads, malformed records, pre-uninstall success/failure, and no peer network call.

**Implementation update:** Installed and major-upgrade Forge triggers seed only absent KVS configuration and validate existing records without overwriting them. The pre-uninstall handler attempts local KVS deletion, logging only a sanitized failure; cleanup is best effort, not guaranteed. Four lifecycle tests cover empty reads, idempotent initialization, preserved records, failed/malformed storage, cleanup success/failure, no network call, and untouched runtime RPC secret. All 87 tests, typecheck, build, Biome lint/format, prelint, and Forge lint passed (existing wildcard-egress warnings). The required `bun run check` cannot complete because `lefthook.yml` recursively invokes `npm run check`; no deployment or installation was performed. No scopes or egress rules changed.
