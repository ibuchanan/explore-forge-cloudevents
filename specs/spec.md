# Cross-site event bridge: ping and pong

Status: approved for implementation on 2026-11-01. UI_SPEC.md is also
approved. Deployment and installation still require separate approval.
Platform facts were checked on 2026-10-26. Q45 selects plain KVS and accepts
the sample's rare concurrent-admin-write risk; Q46 defers application-specific
timeout cutoffs until actual timings can be measured. Q47 approves wildcard
backend egress and Q48 approves demonstration limits. Remaining checks are
implementation work, not prerequisites for approval.

## Problem Statement

A developer wants to demonstrate one Forge app exchanging events between
its installations on two Jira Cloud sites. The example should make the
wire contract explicit, generate TypeScript models, and validate events
at runtime rather than trusting incoming JSON.

A Jira administrator needs to configure the other installations that a
site can communicate with. An Automation rule author needs an action
that initiates the exchange using a configured connection.

This is a proof of concept, not a production messaging service. Prefer
the simplest implementation, explicitly at the expense of reliability.
A second exploration goal is to assess how much integration coverage
JSON-RPC alone can provide, with explicit evidence of its reach and gaps.

## Solution

Install the same app on two Jira Cloud sites. An administrator configures
connections using target URLs. Knowing a target URL is the complete trust
handshake for this exploration; there is no additional peer authentication
or pairing protocol.

An Automation Action on site A selects exactly one configured connection
and sends a `ping` CloudEvent to site B. Its standard `source` attribute
is A's event web-trigger URL. B matches that source exactly against its
configured target URLs and sends a separate `pong` event using the
matching reverse connection. B does not reply to an unconfigured URL.
Installations communicate directly, without a relay.

The Action reports ping delivery, not pong receipt. A valid ping is
acknowledged even when B cannot send pong; B logs that failure.
Structured logs using `@forge-ahead/logging` show the exchange; there is
no persistent exchange-status view.

Use CloudEvents 1.0 over HTTP structured JSON, AsyncAPI to describe the
events sent and received, Modelina to generate TypeScript types, and
Zod for runtime validation. Distributed log correlation uses the available
W3C trace-context helpers in `@forge-ahead/logging`, not a separate
app-specific parser or an OTel SDK. Ping and pong carry `traceparent` as
a CloudEvents extension. Missing or invalid context starts a new trace
rather than rejecting an otherwise valid event.

Adapt the command-oriented foundation demonstrated by
`explore-forge-json-rpc-backbone`: a Forge UI resolver and a bearer-protected
JSON-RPC web trigger share configuration behavior and installation-scoped
KVS. The resolver checks Jira `ADMINISTER` permission on every call.
A shared send-ping operation is available to both Automation and an
authenticated RPC command, so integration tests can initiate delivery
without UI. Using Automation on two real sites remains the manual demo.

Configuration credentials are separate from peer event delivery: the
CloudEvents endpoint remains URL-only and never requires the RPC secret.

### Terms

- **Installation**: this app installed on a particular Jira Cloud site.
- **Event endpoint**: the installation's event-receiving web-trigger URL.
  This is separate from the bearer-protected JSON-RPC web trigger.
- **Connection**: an immutable administrator-managed peer record with
  a stable generated `id`, display `name`, and HTTPS target `eventUrl`.
  The target may be a native event endpoint or a forwarding proxy.
- **Configured**: valid peer settings are stored; this says nothing about
  connectivity, reverse configuration, or completed exchanges.
- **Reverse connection**: the receiver's configured connection back to
  the originator, selected by exact matching against incoming `source`.
- **Source**: the emitting installation's event endpoint URL in the
  CloudEvents `source` attribute. This is routing metadata, not an
  authenticated sender identity.
- **Originator**: the installation sending ping through Automation or RPC.
- **Receiver**: an installation receiving that ping and returning a pong.
- **Exchange**: a ping and its corresponding pong for one destination.
  Pong refers to ping through `data.pingId`.
- **JSON-RPC backbone**: the shared command dispatcher used by protected
  HTTP and Forge resolver adapters for configuration and integration tests.
- **Send-ping operation**: the single implementation for sending ping to
  one configured connection, shared by the Automation and RPC adapters.

## User Stories

These stories reflect the approved behavior; implementation verification is
tracked below.

1. As a developer, I want the same app installed on both sites, so that
   I can demonstrate communication between installations of one app.
2. As a Jira administrator, I want to configure connections at site level,
   so that rule authors can reuse centrally managed destinations.
3. As a Jira administrator, I want knowing the target URL to be enough
   to configure trust, so that the exploration needs no pairing protocol.
4. As an Automation rule author, I want an action that initiates a ping,
   so that an existing rule can start a cross-site exchange.
5. As an Automation rule author, I want to select exactly one configured
   connection, so that each action has a single explicit destination.
6. As a receiving installation, I want ping's source to identify its
   originator's event endpoint, so that I can select the correct reverse
   connection among many.
7. As a receiving installation, I want to use that configured reverse
   connection to send pong as a separate event, so that both sites
   demonstrate event delivery using configured destinations.
8. As a developer, I want direct delivery between installations, so that
   the proof of concept requires no separate relay infrastructure.
9. As a developer, I want standard CloudEvents structured JSON messages,
   so that the wire envelope and encoding are explicit and interoperable.
10. As a developer, I want AsyncAPI to describe sent and received events,
    so that the communication contract can be inspected independently
    of the implementation.
11. As a developer, I want Modelina-generated TypeScript models,
    so that application types are derived from the event contract.
12. As a developer, I want Zod validation at event trust boundaries,
    so that invalid input is not treated as a valid event.
13. As a developer, I want a JSON-RPC configuration interface,
    so that integration tests can exercise configuration without UI.
14. As a demonstrator, I want to run Automation on two real Jira sites,
    so that I can manually verify and show the actual integration.
15. As an Automation rule author, I want the Action to report ping
    delivery rather than round-trip completion, so that pong failure
    is not confused with failure to deliver ping.
16. As a demonstrator, I want structured exchange logs through
    `@forge-ahead/logging`, so that I can show the event round trip
    without building an exchange-status dashboard or storing event history.
17. As a developer, I want a single delivery attempt per event and no
    reliability machinery, so that the exploration stays minimal.
18. As a developer, I want receiving pong to end the exchange,
    so that ping and pong cannot create an endless reply loop.
19. As an originator, I want each pong to include its ping's ID,
    so that concurrent exchanges can be distinguished without a ledger.
20. As an administrator, I want missing or ambiguous reverse connections
    to produce an acknowledgement and an explicit log with no pong,
    so that reply routing never falls back to a guessed destination.
21. As a developer, I want distributed tracing metadata supported by
    `@forge-ahead/logging`, so that the example models good tracing
    practice without owning its own trace-context implementation.
22. As a receiving installation, I want invalid events rejected without
    sending pong, so that malformed messages cannot start an exchange.
23. As an approved test operator, I want bearer-protected JSON-RPC access,
    so that I can configure and test without making configuration public.
24. As a Jira administrator, I want backend permission checks on UI calls,
    so that showing an admin page is not the only authorization control.
25. As a developer, I want Automation and RPC to share the send-ping
    operation, so that testing without Automation exercises the same logic.
26. As an integrator, I want an OpenRPC command contract distinct from
    AsyncAPI's event contract, so that neither protocol is misrepresented.

## Implementation Decisions

### Topology, trust, and routing: confirmed

- Build one Forge app for Jira Cloud. Each installation can originate
  ping and receive events through one event endpoint.
- Communicate directly without a separately operated relay service.
- The Automation Action selects exactly one administrator-configured
  connection. This supersedes the initial multi-destination requirement.
- Use URL-only trust. Do not introduce keys, signatures, tokens,
  invitations, or another peer authentication handshake. A claimed
  source is routing metadata, not proof of sender identity.
- Use the emitter's event web-trigger URL as CloudEvents `source`.
  Match incoming ping's source exactly against configured target URLs.
  Send pong only using the uniquely matching stored reverse connection.
  Do not broadcast or follow an unconfigured callback URL.
- If no reverse connection matches, or the match is ambiguous,
  acknowledge the valid ping, log why pong could not be sent, and do
  not send pong. Do not guess a destination.

### Event contract: confirmed

- CloudEvents specification version: `1.0`.
- HTTP encoding: structured JSON, `application/cloudevents+json`.
- One event per request, with literal event types `ping` and `pong`.
  No batches, binary encoding, or additional event naming conventions.
- Each event has its own fresh `id` and its emitter's `source`.
- Ping has `data: {}`. No custom payload is supplied by the Action.
- Pong has `data: { pingId: "<original ping id>" }`.
- Pong is a separate return event, never the HTTP response body to ping.
- Receiving pong is terminal: it never generates another event.
- Include distributed tracing metadata using the available logging
  helpers and agreed CloudEvents carrier and restart policies below.
- Event identity, `pingId` correlation, and tracing are distinct concerns.
  Tracing does not replace the agreed ping/pong data structures.

### Trace helper contract: verified library behavior

- The installed `@forge-ahead/logging` 0.6.0 exports `TraceContext`,
  `TraceContextOptions`, `parseTraceparent`, `createTraceContext`,
  `formatTraceparent`, and `withLogContext` from its root entry point.
  No dependency update is needed to expose these helpers locally.
- `parseTraceparent(value)` accepts an unknown value and returns a
  `Result<TraceContext, ProblemDetails>`. Missing or invalid values return
  a sanitized `Err`; they do not automatically restart a trace or set an
  HTTP response. Its reported `400` is not an app rejection decision.
- `createTraceContext()` creates an unsampled root with fresh trace and
  span IDs. `createTraceContext({ parent })` preserves the trace ID,
  creates a fresh span ID, records `parentSpanId`, and inherits the sampled
  bit. Handle its `Result`; do not assume ID generation cannot fail.
- `formatTraceparent(context)` returns a `Result` containing a version-00
  W3C value. The wire parent ID is the sender's own `spanId`, not its
  `parentSpanId`; only the sampled flag is emitted.
- `withLogContext({ ...context }, operation)` binds trace fields within
  an isolated async scope, including across awaited work. Parsing and
  generation alone do not enrich logs. Use existing structured logging
  inside the scope, without overwriting trace fields per log call.
- These helpers do not inspect CloudEvents or HTTP headers, choose
  carriers, record spans, export telemetry, or manage `tracestate` or
  baggage. Incoming context is untrusted correlation metadata.

### Trace propagation: confirmed carrier and restart policies

Q19 confirms the CloudEvents carrier, and Q20 confirms child creation for
valid incoming context and a new root for missing or invalid context.
Q24 confirms the separate local helper-generation failure policy below.

- Use a top-level CloudEvents `traceparent` extension on ping and pong
  in the structured JSON envelope, outside `data`. Use it as the single
  authoritative carrier; do not also propagate or fall back to HTTP
  trace headers. Event payloads remain `{}` and `{ pingId }`.
- Start one fresh root context in the shared send-ping operation, whether
  called by Automation or authenticated RPC. Bind it while logging and
  sending ping. Serialize it with `formatTraceparent` into ping's extension;
  no separate producer span context is needed.
- On B, parse ping's extension with `parseTraceparent` and create a local
  child with `createTraceContext({ parent })`. Bind the child while
  processing ping and sending pong. Pong carries this child's formatted
  context, not the original ping's unmodified value.
- On A's pong receiver, parse and create another child before logging
  local work. A healthy exchange retains one `traceId` with distinct
  local span IDs and the chain Action -> ping receiver -> pong receiver.
  This is a correlation hierarchy, not a set of recorded OTel spans.
- Missing or invalid context starts a new unsampled root at the receiver,
  with a bounded diagnostic and no echo of the invalid value. Tracing
  metadata alone does not turn an otherwise valid event into `400`.
  A restarted trace can be joined through event IDs and `pingId`.
- Do not propagate `tracestate` or baggage, add a tracing SDK/exporter,
  or override the library's sampling defaults. Sampling does not suppress
  ordinary logs. Do not automatically continue a trace from Automation
  request headers or the JSON-RPC interface.
- Describe the optional extension in Zod and AsyncAPI, preserving it in
  generated models. Let the logging helper own W3C value validation;
  structural schema validation must not preempt the agreed restart policy
  by rejecting an event solely for a missing or invalid trace value.

### Local trace-helper failure handling: confirmed

- A local creation or formatting failure is an explicit sanitized
  operational failure, not malformed peer input. Do not dereference an
  `Err`, send invalid trace metadata, or fall back to trace-less delivery.
- Before dispatching ping, fail the shared operation and its Automation
  or RPC caller without sending. While handling valid ping, log the
  failure, skip pong, and return the agreed empty `204`. Pong stays terminal.
- Do not retry. This concerns a local helper failure, such as unavailable
  cryptographic ID generation, not Q20's restart policy for incoming data.

### Contract tooling: confirmed

- Author the event schemas in Zod as the authoritative schema definitions.
- Export those schemas as JSON Schema draft 7 for use in an AsyncAPI 3.0
  document specifying the complete messages sent and received.
- Generate plain TypeScript interfaces from AsyncAPI using Modelina.
  Zod remains responsible for runtime validation; TypeScript interfaces
  do not provide it.
- Keep generated contract and model artifacts aligned with the Zod source
  through regeneration and automated drift checks. Do not hand-maintain
  duplicate schemas or assume Modelina generates Zod validators.
- The generation pipeline is settled; artifact layout and the mechanics
  of regeneration and drift checking are implementation details.

### Delivery and observation: confirmed

- The Action reports ping delivery and does not require pong receipt.
  A valid ping is acknowledged even when its receiver cannot send pong.
  A failed pong delivery is logged, not converted into failed ping delivery.
- Attempt pong delivery inline within the receiver's ping-handler invocation,
  then acknowledge ping. Do not schedule work to run after returning a
  web-trigger response or add a queue.
- The Action can remain open during this inline attempt. Its success
  still depends only on ping delivery, not on pong succeeding. Immediate
  acknowledgement before the pong attempt is not a requirement.
- Make at most one delivery attempt for each event. No provisional
  application-specific timeout cutoff is required before measurements;
  Forge's invocation limits may terminate a slow attempt. No automatic retry,
  duplicate suppression, queue, durable exchange tracking, or eventual
  delivery promise is required.
- Use `@forge-ahead/logging` for structured records of ping sent, ping
  received, pong sent, pong received, and failures. Include event IDs,
  `pingId` where applicable, non-sensitive connection identifiers, and
  explicitly bound `traceId`, `spanId`, `traceFlags`, and `parentSpanId`
  when present, using the logging library's async context helpers.
- Do not log full endpoint URLs, raw event bodies, or whole CloudEvents
  objects: `source` itself contains a capability-bearing URL.
- Logs, not a dashboard or persistent exchange history, are the
  demonstration's observation surface.

### Validation and HTTP responses: confirmed

- Validate events before dispatch; accept only POSTed structured
  CloudEvents JSON with the agreed event types and data.
- Return `405` for unsupported HTTP methods, `415` for unsupported content
  types, and `400` for malformed or unsupported events. Rejected requests
  do not emit an event.
- Return an empty `204` for accepted events. A valid ping is accepted
  even when no reverse connection matches, matching is ambiguous, or
  the separate pong delivery attempt fails. Log those conditions.
- Log bounded rejection diagnostics without endpoint URLs or raw bodies.
- W3C value validation belongs to `parseTraceparent`. Its `Err` does not
  itself set this handler's HTTP response. An otherwise valid event with
  missing or invalid trace context starts a fresh root and remains accepted.

### JSON-RPC foundation, authorization, and storage: confirmed

- Adapt the command-oriented architecture demonstrated by the private
  `explore-forge-json-rpc-backbone` reference app, not as a published
  dependency or a copy of its app identity or sample prefix commands.
- Configuration behavior has one shared dispatcher, called by a typed
  Forge resolver and a JSON-RPC HTTP adapter. Both use installation-scoped
  Forge KVS; caller identity and permissions are established by adapters,
  never accepted from request JSON.
- On every configuration UI call, check Jira `ADMINISTER` permission on
  the backend using the Forge-authenticated user. Permission-check failure
  denies access. A bearer token is not an Atlassian user identity.
- Protect the separate configuration/testing web trigger with the
  reference's encrypted per-environment runtime bearer secret. Missing
  secret fails closed; missing or invalid credentials cannot dispatch.
  Do not expose the secret through configuration, UI, logs, or responses.
- The CloudEvents receiver stays URL-only. Peer events do not carry the
  RPC bearer credential, and knowing an event URL grants no RPC access.
- Retain the reference's single-call JSON-RPC 2.0 subset: required finite
  numeric or string request IDs, object parameters, no batches,
  notifications, positional parameters, or null request IDs.
- Retain sanitized protocol and command errors, no raw exception output,
  server-constructed caller context, and contract-consistency tests.
- Publish commands as OpenRPC, separate from the AsyncAPI event contract.
  Apply the reference's protocol conventions to this app's commands;
  configuration commands operate on the agreed connection collection;
  their names, mutation behavior, and result shapes are confirmed below.
  Do not automatically add its prefix, preview, or UI-only reset features.

### Event endpoint and ping commands: confirmed

- Q25 confirms `endpoint.get` with empty object parameters and result
  `{ eventUrl }`. Retrieve this installation's event web-trigger URL through
  the Forge SDK, not a caller-supplied local URL. Authorized UI and RPC
  callers use the same command. Return no RPC secret; omit URLs from logs.
- Q26, Q28, and Q33 confirm `ping.send` accepts `{ connectionId }`, selecting
  exactly one configured connection by stable ID, not an arbitrary URL.
- On successful ping delivery, return
  `{ delivered: true, pingId, traceId }`. Delivery means acknowledgement of
  ping, not pong receipt. These IDs support correlation, not stored status.
- Validation, connection lookup, trace generation, timeout, and delivery
  failures produce sanitized command errors. The Automation adapter maps
  the same operation failures into Action failures. Do not expose endpoint
  URLs in errors. Exact error-code assignments remain to be specified.
- Q27 confirms local RPC integration tests plus the manual two-site
  Automation demo as required evidence. Defer a deployed RPC verification
  script; it is not an implementation or acceptance requirement.
- Evaluating how much integration coverage JSON-RPC alone provides is an
  explicit purpose of this repository. Exercise app behavior through RPC
  wherever possible and document what that interface cannot establish;
  do not equate a successful `ping.send` result with pong receipt.

### Shared send-ping operation and integration seam: confirmed

- Automation and an authenticated RPC command invoke one send-ping
  implementation accepting exactly one configured connection. The RPC
  wrapper must not create a separate delivery implementation.
- The operation resolves the configured connection by ID, creates ping
  and tracing metadata, makes at most one attempt, and reports delivery
  only. Its result does not certify pong receipt. Q26 fixes the success
  result; unknown/deleted IDs fail without sending or fallback.
- CloudEvents reception and reverse routing remain separate from RPC;
  do not wrap incoming ping/pong in JSON-RPC or use RPC for peer delivery.
- The Automation adapter uses trusted Forge invocation context, not the
  external RPC bearer or a caller flag in Action inputs. Verify the actual
  Automation caller and config-resolver permission requirements before
  implementation; do not treat it as an admin UI invocation by default.
- The shared send-ping operation starts a fresh trace whether invoked
  through Automation or authenticated RPC. Do not inherit HTTP headers.
- Integration tests can configure and initiate ping through authenticated
  RPC without driving UI or Automation. This explicitly supersedes the
  earlier instruction not to define an RPC delivery command.
- The reference's architecture and tests are available now. Its prefix
  example is not a connection model, and its local tests do not prove
  this app's installed wiring or two-site delivery.

### Connection model and lifecycle: confirmed

- Adapt the lifecycle pattern from `explore-forge-config-lifecycle` to a
  collection of peer connections, not its single URL/token example.
- Each connection is `{ id, name, eventUrl }`: a stable generated ID,
  a display name, and a target event web-trigger URL. No peer token or
  enable/disable state is required. Automation and `ping.send` select by ID.
- Reject duplicate target event URLs so normal configuration gives one
  reverse-routing match. Preserve exact source-to-URL matching; do not
  silently rewrite capability URLs. Defensive ambiguous-match handling
  still applies to otherwise valid configurations with ambiguous matches.
- Initialize an empty collection only when storage is absent. Repeated
  lifecycle invocations and upgrades must preserve saved connections.
  Missing storage before initialization reads as an empty collection.
- A failed storage read or malformed stored document is a sanitized error,
  not an empty/unconfigured result. Do not overwrite unreadable data or
  seed defaults after a failed read. UI errors must not imply data was lost.
- Saving validates and stores without contacting the peer. Configured
  means usable settings exist, not reachable, reverse-configured, or that
  a round trip has completed. Use explicit `ping.send` and logs for those
  separate observations; never send automatically on page load.
- Attempt local configuration cleanup on pre-uninstall; log failures and
  do not promise guaranteed deletion. Do not contact peers or delete the
  environment-level RPC bearer variable. No per-peer token exists to clean.
- Connections are immutable. Do not provide rename or edit, even for the
  display name. Any change requires delete and create with a fresh ID.
- Use the confirmed command contracts:

  | Command | Parameters | Result |
  | --- | --- | --- |
  | `connections.list` | `{}` | `{ connections: [...] }` |
  | `connections.create` | `{ name, eventUrl }` | `{ connection }` |
  | `connections.delete` | `{ connectionId }` | `{ deleted: boolean }` |

  Each returned connection is `{ id, name, eventUrl }`. There is no rename,
  update, or global reset command.
- Check name and URL uniqueness against the current collection during normal
  create requests. For this sample, accept that simultaneous admin mutations
  using plain KVS read/modify/write can race: one write may replace another
  successful write, and concurrent creates may bypass uniqueness checks.
  Do not claim conflict-safe writes or build locking, conditional writes, or
  automatic retry machinery. Administrators can reload and correct the rare
  conflict manually; a UI busy flag only prevents overlapping local actions.
- A send that has already resolved a connection may finish using that
  snapshot after concurrent deletion. Deletion prevents subsequent lookups,
  but does not cancel in-flight network work. Do not hold configuration
  locks across HTTP calls or introduce cancellation infrastructure.
- Deleting an existing ID returns `{ deleted: true }`; an absent ID returns
  `{ deleted: false }`. Deletion is idempotent and makes no peer request.
- Trim display names before validation, storage, and comparison. Require
  non-empty names unique within the installation using case-sensitive
  comparison. Names differing only in case are permitted; IDs, not names,
  remain the Action references.
- `ping.send` accepts `{ connectionId }`. Unknown or deleted IDs fail
  explicitly without sending or selecting another connection. Recreating
  the same name or URL never rebinds Actions referencing the deleted ID.
- Deleting the last connection returns to empty/unconfigured without
  changing the local event URL or the RPC credential.

### Destination URL policy: confirmed

- Accept HTTPS destinations without a Forge-specific hostname allowlist.
  Do not exclude potential proxies through unnecessarily strict host
  validation. No proxy-specific feature, advertised-URL setting, forwarding
  implementation, or proxy demo is required in this iteration.
- Keep CloudEvents `source` and `endpoint.get` SDK-derived as agreed. Q36
  rejects an advertised-source override; reverse routing still matches
  that native source exactly. Permissive target validation does not promise
  arbitrary proxy topologies work with the existing routing contract.
- Reject embedded credentials, query strings, fragments, and connections
  to this installation's own event endpoint. Reject before storage or send.
- Do not follow redirects for ping or pong, including HTTPS-to-HTTPS
  redirects. A redirect response is a delivery failure, not a new target.
- Preserve accepted URLs for exact reverse matching; do not silently
  rewrite a capability URL or infer sender identity from a hostname.
- HTTPS and these checks are not sender authentication or a production
  SSRF guarantee. With no host allowlist, administrators control targets;
  manifest egress must support the agreed policy and be reviewed explicitly.
- Self-connection checks cover the known local URL. Detecting arbitrary
  proxy aliases returning to the same installation is not guaranteed by
  URL equality and must not be claimed.

### Admin surfaces: confirmed scope

- Include all three admin surfaces: Configure, Get Started, and a persistent
  sidebar Status page. Q31's "all 3" refers to these admin pages; an issue
  panel is not included.
- Configure shows the SDK-resolved local event URL with Copy, the connection
  list, and an inline Name/URL create form. There are no edit or reset
  controls. It uses `endpoint.get` and the confirmed connection commands.
- Delete requires confirmation warning that saved Actions referencing this
  ID will fail. Deletion cannot cancel delivery already in progress.
- Each connection has an explicit Send ping action calling `ping.send`.
  Successful feedback is "Ping delivery acknowledged", not "Connection
  healthy" or "Round trip successful". Display sanitized failures without
  endpoint URLs. Sending is never automatic on load or refresh.
- Q43 confirms Get Started as a short setup-and-demo guide, not a tracked
  onboarding workflow. Explain installation on both sites, copying event
  URLs, creating reciprocal connections through Configure, adding the
  Automation Action with one selected connection, and running the rule
  while inspecting structured ping/pong and trace-correlation logs.
- Include the local event URL with Copy and links to Configure and Status.
  Show whether local connections exist, but do not claim reciprocal setup,
  connectivity, or the round trip is verified. No saved checklist, automatic
  probes, or separate Send ping control.
- Keep instructions visible while local configuration loads. Distinguish
  missing configuration from read failures with sanitized Error feedback;
  a read failure is never displayed as unconfigured.
- Q42 confirms Status as a read-only configuration summary: "No connections
  configured" or "N connections configured", the native local event URL
  with Copy, links to Configure and Get Started, and Refresh.
- Status Refresh only reloads configuration; it never probes or sends ping.
  Show Loading and sanitized Error states distinctly. A failed read must
  not appear empty/unconfigured. Show no health indicator, Send ping,
  exchange history, or round-trip success claim on Status.
- All three pages use shared commands and backend Jira-admin checks,
  not separate resolver-only configuration implementations.
- Q44 completes Configure's state behavior: during Loading show progress
  and disable connection actions; Empty shows "No connections configured"
  with the create form. Busy operations show progress and prevent overlapping
  submissions from the page. Errors retain entered values, show sanitized
  feedback, and offer read-only refresh; failed reads never appear empty.
- If a create/delete response is lost, reload configuration before
  resubmitting. If Send ping times out, do not retry automatically: delivery
  may already have occurred. No optimistic success or automatic retries.
- The agreed Ideal, Empty, Loading, Error, busy, and uncertain-outcome states
  are consolidated in the approved [UI_SPEC.md](UI_SPEC.md). Both specs are
  approved for implementation; deployment and installation remain separate.
- No GET-based connectivity check, automatic ping on refresh, token form,
  issue panel, or raw connection URL logging is copied from the sample.

### Implementation verification

- Both peer-project references and logging helpers are available. Their
  integration choices above replace the earlier blanket deferrals; they
  are no longer upstream blockers or published library dependencies.
- Verify platform routing, required scopes, and egress constraints before
  declaring manifest permissions. Do not blindly copy reference scopes.
- The app spec and UI spec are approved for implementation. This approval
  does not authorize deployment or installation.

### Platform verification: 2026-10-26

These are documentation and installed-SDK findings, not deployed acceptance
or permission to change the manifest. UI_SPEC.md remains approved.

- Forge permits 25 seconds for UI invocations and 55 seconds for web
  triggers and action execution. Configure's Send ping uses a UI resolver,
  so the shared operation must fit that shorter path. The documented
  180-second outbound limit is for long-running async functions, not a
  usable budget for this flow. No separate 10-second Automation config
  resolver limit was established by the sources reviewed.
- Installed `@forge/api` 8.3.0 exposes `signal` and `redirect` in fetch
  options and passes them to runtime fetch. Use abortable requests and
  explicit no-follow behavior; the default redirect behavior is unsuitable.
  SDK support is verified, not live runtime enforcement in this app.
- Basic KVS transactions atomically group writes but expose no revision
  condition on those writes. Reading a collection and writing it back can
  lose concurrent changes even inside an atomic write transaction.
- Custom Entity Store transactions condition writes on current attributes
  and fail the transaction if a condition is false. A versioned collection
  record can therefore implement optimistic concurrency: consistently read
  the record, validate uniqueness, and replace it only if its revision still
  matches. A fresh revision prevents stale writers succeeding. This uses
  the same `@forge/kvs` package, not an external lock or SQL service.
- The reference's `@forge/kvs` 2.1.0 exposes conditional entity transaction
  writes, equality filters, and `FAIL_IF_EXISTS` entity initialization.
  `entity().get` is documented strictly consistent; queries are eventually
  consistent and must not establish uniqueness or current collection state.
  Creation-if-absent prevents initialization overwriting a concurrent save.
- A custom entity requires a manifest declaration and `storage:app`. Each
  object is limited to 240 KiB. Entity and attribute declarations cannot
  simply be removed after deployment, so this is a persistence decision,
  not a transparent replacement of the reference's plain KVS document.
- Arbitrary target hosts can be supported by backend egress `*`. The app
  still enforces HTTPS and its URL restrictions. This is broad backend
  permission, not client egress, analytics, sender authentication, private
  network access, or an SSRF guarantee. No web-trigger egress exemption was
  established; declare required permissions explicitly.
- Dynamic web triggers are not eligible for Runs on Atlassian. The RPC
  trigger needs dynamic results, and the current manifest already declares
  dynamic sample triggers. Adding the first dynamic trigger or broadening
  egress can require a major version/renewed consent; the actual upgrade
  must be reviewed before an approved deployment.
- Pre-uninstall is non-blocking with a 55-second timeout; failure does not
  stop uninstall. This supports the agreed best-effort cleanup, not a
  guaranteed deletion claim. SDK web-trigger URLs are stable for their
  app/site/product/environment/module combination; avoid force-creation
  or format changes that would disturb exact source matching.

### Q45–Q48 decisions (2026-11-01)

- Q45: use Forge KVS for the connection collection, not Custom Entity Store;
  the latter is an awkward fit for the domain boundary. For this sample,
  ordinary KVS read/modify/write is sufficient. Validate name and URL
  uniqueness on the collection read for each create; accept the small risk of
  lost updates or duplicate records under simultaneous admin writes. Do not
  introduce Custom Entity Store, locks, or concurrency infrastructure just
  to eliminate that risk. Document this limitation honestly.
- Q46: defer application-specific HTTP and initiating-operation timeouts
  until actual execution times can be observed and measured. The previously
  proposed 15/5/20-second cutoffs are not approved. Start with at most one
  attempt and no automatic retry, without a provisional app cutoff. Forge
  invocation limits still apply and can prevent a slow operation from
  returning an acknowledgement; decide any app cutoff from measurements.
- Q47: wildcard backend egress `*` is acceptable for this sample app.
  Accept the associated Runs on Atlassian ineligibility and review consent or
  versioning consequences before deployment. Keep the HTTPS, URL-only trust,
  and no-redirect requirements; do not label peer delivery as analytics.
- Q48: cap the installation at 20 connections, trimmed names at 100 Unicode
  code points, target URLs at 2,048 UTF-8 bytes, and incoming event JSON at
  16 KiB before parsing. These are demonstration limits, not Forge maxima.
  Reject over-limit creates without changing stored data. Reject oversized
  events with the agreed `400` and no reply. Cap serialized storage below
  KVS limits, which must be verified for the chosen representation; the
  Custom Entity 240 KiB limit is not the applicable storage contract.
  No application queue or global delivery concurrency controller is added.

Sources checked through Forge documentation search and installed types:

- [Invocation limits](https://developer.atlassian.com/platform/forge/limits-invocation/)
- [KVS transactions](https://developer.atlassian.com/platform/forge/storage-reference/kvs-transactions/)
- [Conditional entity transactions](https://developer.atlassian.com/platform/forge/storage-reference/entities-transactions/)
- [Entity storage and initialization](https://developer.atlassian.com/platform/forge/storage-reference/entities-api/)
- [Entity consistency](https://developer.atlassian.com/platform/forge/storage-reference/entities/)
- [Entity declarations and limits](https://developer.atlassian.com/platform/forge/storage-reference/entities-manifest/)
- [Egress permissions](https://developer.atlassian.com/platform/forge/manifest-reference/permissions/)
- [Runtime egress and consent](https://developer.atlassian.com/platform/forge/runtime-egress-permissions/)
- [Web-trigger types and versioning](https://developer.atlassian.com/platform/forge/manifest-reference/modules/web-trigger/)
- [Web-trigger URL SDK](https://developer.atlassian.com/platform/forge/runtime-reference/web-trigger-api/)
- [Pre-uninstall](https://developer.atlassian.com/platform/forge/manifest-reference/modules/pre-uninstall-trigger/)
- [Automation execution and user context](https://developer.atlassian.com/platform/forge/manifest-reference/modules/automation-action/)

### Implementation checks and later measurement

- Measure actual operation times before deciding any application-specific
  timeout policy. There is no provisional cutoff; compare measurements with
  platform invocation limits and the single-attempt behavior.
- Verify the KVS size limit for the chosen connection representation.
- Assign specific sanitized RPC error codes while implementing OpenRPC;
  test consistency between the contract and command errors.
- Assess the demonstrated reach and gaps of RPC-driven integration coverage.
  Do not add a deployed verifier merely to make assertions convenient.
- The approved manual demo must verify live Forge networking, redirect
  behavior, and installation isolation; docs and SDK inspection alone are
  not proof. Self-checks do not detect arbitrary proxy aliases.

The reference review is complete. These are implementation and live-verification
tasks, not unanswered approval questions or a request to rebuild either
reference. Deployment and installation still require separate approval.

## Testing Decisions

### Confirmed integration testing boundary

Use the adopted JSON-RPC command interface to exercise configuration
and the same send-ping operation used by Automation, without UI. Follow
the reference's local tests: substitute storage and platform/network I/O
at their adapters while retaining dispatch, validation, command behavior,
and result/error mapping. Do not create a second delivery implementation
for tests or drive private helpers instead of the shared interface.

The RPC HTTP adapter and UI resolver need separate tests for authentication
and authorization. OpenRPC contract tests check method, parameter, result,
and error consistency; AsyncAPI tests check the separate event contract.

Required integration evidence is local RPC-driven tests plus the manual
Automation demo across two real installations. A deployed RPC verification
script is deliberately deferred, not a requirement or a hidden deliverable.
Future live scripts would need explicit approval because they can write
configuration and send events.

Assess RPC as the primary behavioral test interface, not just a transport
to cover incidentally. Record which scenarios are exercised through it,
which need another public interface or log observation, and which remain
manual or unverified. Do not invent status/history commands merely to make
assertions convenient. Focused tests of CloudEvents and authorization
adapters remain appropriate; RPC-only coverage is an exploration to assess,
not an assertion that RPC can replace every platform or protocol check.

A green RPC test or `delivered: true` establishes only what its harness
actually observes. It does not alone prove pong receipt, real network
routing, deployed KVS isolation, UI wiring, or Automation integration.
An in-memory adapter must not be described as live platform evidence.

No tests are implemented by this draft. The current repository has Vitest
configuration but no app tests; the reference provides concrete prior art
for dispatcher, transport, resolver, storage, and contract tests. Local
mocked evidence does not establish live Forge wiring or site isolation.

### Proposed automated coverage

- Through RPC, check the exact list/create/delete request and result
  contracts. Create returns the generated record; list returns records;
  delete returns true once and false when repeated for an absent ID.
- Trim names, reject empty or duplicate case-sensitive names, permit names
  differing only in case, and reject duplicate target URLs. Reverse matching
  remains exact. Creation, deletion, and reads make no network probes.
- Check `endpoint.get` and emitted `source` use the native SDK URL; there
  is no advertised-source setting. A generic HTTPS host passes validation
  without claiming an arbitrary proxy deployment completes a round trip.
- Check no rename, update, or global reset command exists. Delete/create
  produces a new ID; stale Automation/RPC IDs fail without a send, even
  when a new connection has the same name or URL. Last deletion is empty.
- Check name and URL uniqueness for sequential create requests. Document
  that concurrent admin mutations can lose updates or create duplicates with
  plain KVS read/modify/write; do not assert conflict-safe writes in tests.
- Delete during an already-resolved delivery and let that attempt finish;
  a subsequent `ping.send` for the deleted ID fails without network I/O.
  Use controlled synchronization, not timing sleeps, to exercise this case.
- Accept non-Forge HTTPS targets for proxies. Reject non-HTTPS URLs,
  credentials, query strings, fragments, and the known local endpoint.
  Verify redirect responses are failures without a second request and
  neither logs nor errors disclose the rejected target or redirect URL.
- At the lifecycle interface, check empty first-install state and no
  overwrite of saved connections on repeated initialization. Verify the
  expected empty state before initialization through configuration reads.
- Through configuration reads, distinguish absent storage from storage
  failure or malformed data. Failures must not erase or silently seed data.
- Check pre-uninstall cleanup attempts local deletion, reports failures
  safely, and neither contacts peers nor deletes the RPC runtime variable.
- Check Configure exposes Copy, create, confirmed deletion, and explicit
  Send ping through shared commands, with no rename or reset controls.
  Delivery acknowledgement must not be labelled healthy or round-trip
  success. No page load or refresh triggers ping.
- Check Status count/empty text, local URL Copy, navigation, and read-only
  Refresh. Loading and failure must not masquerade as unconfigured. No
  health claims, ping controls, or exchange history belong on this page.
- Check Get Started instructions remain visible during loads and errors,
  with local configuration status, Copy, and navigation. No saved checklist,
  remote verification claim, automatic probe, or separate ping control.
- Check Configure disables actions during Loading/Busy, preserves form
  input on errors, and never shows failed reads as empty. Lost mutation
  responses require read-back before resubmission; ping timeouts never
  cause automatic retry or a false claim of non-delivery.
- Check all three pages against UI_SPEC.md without claiming reachability.
  Lifecycle/UI tests are reported separately from RPC integration coverage.
- Exercise the same configuration commands through protected RPC and
  authorized resolvers with installation-isolated storage. Reject missing
  or invalid credentials, denied or failed permission checks, and forged
  caller context before allowing command side effects.
- Check the single-call RPC subset and sanitized protocol/command errors
  against OpenRPC, including unsupported batches and notifications.
- Invoke `ping.send` and the Automation adapter's shared operation;
  compare delivery and failure mapping. Check `{ delivered: true, pingId,
  traceId }` on acknowledgement without asserting pong receipt.
- Check authorized `endpoint.get` returns the local SDK-resolved event URL
  without disclosing the RPC secret or logging capability URLs.
- Test local helper failures explicitly: no send on initiation failure;
  no pong but empty `204` for valid ping; no trace-less fallback or retry.
- Check CloudEvents 1.0 structured JSON envelopes, fresh event identity,
  empty ping data, and pong's reference to the original ping ID.
- Check `405` for unsupported methods, `415` for unsupported content
  types, and `400` for malformed or unsupported events, with no emitted
  event. Accepted ping and pong receive empty `204` responses, including
  ping for which pong cannot be sent.
- Regenerate JSON Schema, AsyncAPI schema content, and Modelina interfaces
  from the authoritative Zod definitions and check for drift. The exact
  artifact layout and command wiring are implementation details.
- Check exact source-to-target URL matching among many connections.
  Missing or ambiguous matches acknowledge ping, log the problem,
  and send no pong.
- Check terminal pong handling, at most one delivery attempt, and
  acknowledgement despite failure to send pong; do not assume an app cutoff.
- Check the agreed trace flow: both outbound events carry a top-level
  helper-formatted `traceparent`; receivers use fresh local child IDs;
  a healthy exchange retains one trace ID and the sampled bit.
- Check wire parent IDs refer to the sending scope, and bound local logs
  do not reuse the remote span ID. `pingId` correlation stays independent.
- Check missing and invalid context start new unsampled roots without
  rejecting otherwise valid events. HTTP headers are not fallback carriers.
  Do not duplicate the helper's exhaustive W3C parser test suite here.
- Capture concurrent invocation logs and check that ambient trace fields
  do not leak between exchanges. Check operational `Err` handling, no
  disclosure of capability URLs or raw context, and no exporter dependency.

Test external behavior and contracts, not private functions, internal
call order, or generated source formatting.

### Proposed manual demonstration acceptance

1. Install the app on A and B and configure connections in both
   directions. Include more than one connection on B.
2. Run an Automation Action on A selecting only B. B receives ping and
   sends a separate pong using the connection matching A's `source`.
3. Show that the Action reports ping delivery, not round-trip completion.
4. Show logs for all four exchange stages with `pingId` correlation and
   distributed trace metadata, without displaying endpoint URLs.
5. Remove B's reverse connection: ping is acknowledged, no pong is sent,
   and logs explain the missing connection.
6. Show a failed delivery: one attempt, an explicit failure, and no retry.

## Out of Scope

For this exploration:

- Events other than ping and pong, and synchronizing Jira issue data.
- Separate sender and receiver applications.
- A relay, general-purpose event broker, or multi-destination Action.
- Proxy-specific configuration, forwarding, and advertised-source overrides;
  omitting those features does not impose a destination hostname allowlist.
- Peer authentication beyond possession of the target URL.
- Invitation pairing, automatic discovery, or arbitrary callback routing.
- Retries, duplicate suppression, durable queues, and delivery guarantees.
- An exchange-status dashboard or persistent event history.
- Automated two-real-site Automation end-to-end testing.
- A deployed RPC verification script in this iteration; it is deferred.
- Designing the JSON-RPC reference implementation here.
- Custom W3C parsing, a tracing SDK/exporter, recorded OTel spans,
  `tracestate`, baggage, or a JSON-RPC trace design in this task.
- Deployment or installation without explicit approval.

Proposed exclusions, subject to agreement:

- A schema registry and arbitrary third-party sender support.
- Production-scale throughput, monitoring, and historical event analytics.

## Further Notes

### Current repository evidence

The starter app has two unauthenticated sample web triggers returning
static responses. Connections, administration, an Automation Action,
event contracts, generation, validation, and the exchange are not
implemented yet.

CloudEvents, Modelina, Zod, and `@forge-ahead/logging` dependencies are
already declared. Integration and compatibility require verification.
Installed Modelina supports AsyncAPI inputs through version 3.0.0 and
JSON Schema draft 7. Installed Zod supports export to draft-7 JSON Schema,
which supports the agreed Zod-to-AsyncAPI-to-Modelina pipeline.

### Deliberate limits

Anyone who obtains an event endpoint URL can invoke it. A matching source
is not authenticated and does not provide replay protection. Validation
still applies, but this example must not claim production-grade security.

Without retries or duplicate suppression, exchanges can be lost and
repeated pings can cause repeated pongs. Logs are not a durable delivery
ledger. A delivered ping does not establish that pong was sent or received.
Without stored exchange state, `pingId` supports correlation rather than
proof that a matching ping was previously sent.

Inline pong processing can delay ping's acknowledgement and the Action's
completion. Pong failure itself does not make ping delivery fail, but
network or runtime timeouts can still prevent the acknowledgement from
reaching A. No stronger delivery or timing guarantee is intended.

### Elaboration order

Topology, URL-only trust, exact reverse routing, single-destination Action
delivery, wire encoding, minimal payloads, tracing ownership, logging,
minimal reliability, the testing boundary, schema generation direction,
inline pong processing, and validation and HTTP response policy are settled.

All questions through Q44 are answered. Both reference foundations,
logging helpers, trace policies, configuration/event security, shared
send-ping behavior, endpoint discovery, and success results are settled.
RPC coverage is an exploration goal; require local tests and the manual
Automation demo, not a deployed verifier. Connection contracts, immutable
records, normal-operation uniqueness, in-flight deletion, all three page
flows, recovery behavior, and URL policy are agreed. UI_SPEC.md is approved.
Platform facts are recorded with sources. Q45 chooses plain KVS with accepted
concurrent-admin-write risk; Q46 has no provisional app cutoff pending actual
measurements. Q47 and Q48 are approved, with KVS size verification assigned
to implementation. Both specs are ready for implementation; live acceptance,
deployment, and installation remain separate from this approval.

### JSON-RPC foundation evidence

The reference's dispatcher, HTTP adapter, resolver, KVS adapter, typed
client, and OpenRPC contract establish the adopted shared-command pattern.
Its `config.get`, `config.set`, `config.reset`, and `integration.preview`
operate on a sample prefix, not connections. The UI-only reset policy is
an example of source-based command authorization, not an automatically
adopted connection command.

Reference tests cover dispatch, contracts, HTTP authentication, resolver
permissions, and storage substitution. Its opt-in deployed verifier
includes configuration writes and explicitly avoids exposing raw URLs,
headers, bodies, and exception details. Neither reading the reference nor
local mocked tests prove this app's deployed acceptance.

Forge's web-trigger URL SDK documents retrieving a URL by module key and
stability for a given app/site/product/environment/module combination.
Discovering the current installation's event URL is feasible without
asking the user to supply its own `source`; Q25 adopts `endpoint.get`
for authorized UI and RPC callers.

### Configuration-lifecycle reference evidence

The lifecycle sample demonstrates one URL/token record, idempotent install
seeding, reset, GET connectivity checks, three admin pages, an issue panel,
and separate best-effort config/secret deletion on pre-uninstall.

This app adopts its lifecycle pattern and all three admin pages, adapting
the record to multiple peers without tokens. It does not copy GET probes,
the issue panel, raw external error output, or storage failures disguised
as unconfigured state. Keep the RPC foundation's backend authorization;
the lifecycle sample's resolver registration does not establish it.

Its tests are primarily architecture and wiring checks, not evidence that
this app's collection lifecycle and RPC behavior work. Add behavioral
coverage at the appropriate public interface, and report lifecycle/UI
checks separately when assessing the reach of RPC integration coverage.

### Tracing evidence

The logging library's public API reference and trace-context how-to
specify the helper behavior used here. Its trace-context and ambient
log-context tests cover parsing, parent/child relationships, and async
isolation. The installed 0.6.0 package exposes the same helper entry points.
The app integration tests should cover carrier wiring and observable
exchange logs, not duplicate the library's parser tests.

The helpers provide W3C-compatible identifiers and distributed log
correlation, not recorded/exported spans or a complete OTel integration.
Default redaction does not guarantee removal of URLs in arbitrary fields;
allow-listed log metadata must explicitly omit endpoint URLs and `source`.

This specification remains local. No project issue tracker or triage
label vocabulary has been configured for publishing it. To configure
that workflow later, run `/setup-matt-pocock-skills`.
