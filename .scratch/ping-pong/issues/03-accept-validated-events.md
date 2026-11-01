# 03: Accept validated CloudEvents

**What to build:** This installation exposes one URL-only peer event receiver that recognizes valid ping and pong messages without using the protected configuration RPC credential. A standalone valid event receives an acknowledgement; peer routing is added later.

**Blocked by:** None (can start immediately).

**Status:** completed

- [x] Define authoritative Zod schemas for CloudEvents 1.0 structured JSON: literal `ping` with `data: {}` and literal `pong` with `data: { pingId }`; generate AsyncAPI and TypeScript contract artifacts with drift checks.
- [x] Validate one event per POST before dispatch; reject unsupported method with `405`, unsupported content type with `415`, malformed/unsupported or over-16-KiB JSON with `400`, without emitting an event.
- [x] A valid event returns an empty `204`. For this initial slice, ping reception may report no reverse connection rather than attempt a reply; pong is terminal and never replies.
- [x] Peer reception requires no RPC bearer secret; rejected requests log only bounded, sanitized diagnostics, not raw bodies, endpoint URLs, or whole events.
- [x] Focused tests exercise the public HTTP receiver, schema drift, response codes, and zero outbound events on rejection.

**Update (2026-11-01):** Completed test-first. `runEvent` now validates structured ping/pong requests independently of RPC authentication, and Zod generates checked-in AsyncAPI and Modelina TypeScript artifacts (`bun run src/generate-events.ts`). All 42 tests, typecheck, Forge lint, Biome lint, and format checks pass. The mandated `bun run check` cannot finish while the existing pre-push hook invokes `npm run check` recursively; `size:check` separately reports the configured 10 kB limit exceeded by 508 B. Neither pre-existing hook configuration nor size threshold was changed in this ticket.
