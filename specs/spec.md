# Cross-site event bridge: ping and pong

Status: working draft; all answers through Q20 incorporated. Not approved
for implementation. Trace carrier and restart policies are agreed.
JSON-RPC and connection lifecycle remain deferred; platform constraints
and remaining proposals are still open.

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

A JSON-RPC backbone over a Forge web trigger supports the configuration
flow and serves as an integration testing layer without requiring UI.
Its reference implementation is being developed separately. Using
Automation on two real sites is the manual test and demonstration.

### Terms

- **Installation**: this app installed on a particular Jira Cloud site.
- **Event endpoint**: the installation's event-receiving web-trigger URL.
  This is distinct in purpose from the deferred JSON-RPC interface.
- **Connection**: administrator-managed configuration identifying a
  target installation by its event endpoint URL.
- **Reverse connection**: the receiver's configured connection back to
  the originator, selected by exact matching against incoming `source`.
- **Source**: the emitting installation's event endpoint URL in the
  CloudEvents `source` attribute. This is routing metadata, not an
  authenticated sender identity.
- **Originator**: the installation whose Automation Action sends a ping.
- **Receiver**: an installation receiving that ping and returning a pong.
- **Exchange**: a ping and its corresponding pong for one destination.
  Pong refers to ping through `data.pingId`.
- **JSON-RPC backbone**: the web-trigger-based configuration interface
  used for integration testing; its details are deferred.

## User Stories

These stories reflect the agreed behavior; deferred configuration details
remain open below.

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
    without building a status dashboard or storing exchange history.
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
Local helper-generation failure handling is separately proposed below.

- Use a top-level CloudEvents `traceparent` extension on ping and pong
  in the structured JSON envelope, outside `data`. Use it as the single
  authoritative carrier; do not also propagate or fall back to HTTP
  trace headers. Event payloads remain `{}` and `{ pingId }`.
- Start one fresh root context in the Automation Action. Bind it while
  logging and sending ping. Serialize it with `formatTraceparent` into
  ping's extension; no separate producer span context is needed.
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
  request headers or the deferred JSON-RPC interface.
- Describe the optional extension in Zod and AsyncAPI, preserving it in
  generated models. Let the logging helper own W3C value validation;
  structural schema validation must not preempt the agreed restart policy
  by rejecting an event solely for a missing or invalid trace value.

### Local trace-helper failure handling: proposed

- A local creation or formatting failure is an explicit sanitized
  operational failure, not malformed peer input. Do not dereference an
  `Err` or send invalid trace metadata. If B cannot create/format context
  for pong, log the failure, skip pong, and acknowledge valid ping.
  Failure before Action dispatch fails that Action; pong remains terminal.
- This concerns a local helper failure, such as unavailable cryptographic
  ID generation, not Q20's agreed handling of invalid incoming context.

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
- Process the bounded pong delivery attempt inline within the receiver's
  ping-handler invocation, then acknowledge ping. Do not schedule work
  to run after returning a web-trigger response or add a queue.
- The Action can remain open during this inline attempt. Its success
  still depends only on ping delivery, not on pong succeeding. Immediate
  acknowledgement before the pong attempt is not a requirement.
- Make one bounded delivery attempt for each event. No automatic retry,
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

### Integration boundary and prerequisites: confirmed

- A JSON-RPC configuration backbone over a Forge web trigger provides
  the integration testing layer without UI. Its reference implementation
  is being developed separately.
- Defer JSON-RPC methods, implementation, and test-harness details until
  that reference is ready. Do not invent an RPC event-delivery interface.
- The tracing helper prerequisite is satisfied: the local logging library
  and installed package expose the required API. Use those helpers without
  modifying the library, adding a tracing SDK, or duplicating W3C parsing.
  Q19 and Q20 settle carrier and incoming-context restart behavior.
- JSON-RPC remains an upstream prerequisite; do not replace it with a
  temporary app-local abstraction. Connection lifecycle remains deferred.
- Connection configuration and lifecycle are deferred to the user's prior
  work on connections. Do not adopt the proposed ID/name/URL record,
  uniqueness rule, CRUD operations, or stale Action behavior as settled.
  Preserve the already agreed URL-based routing and Action selection
  requirements when integrating that work.
- Do not implement application behavior, deploy, or install as part of
  this specification task.

### Proposals requiring agreement

- Prefer Forge built-in storage. Verify platform routing and egress
  constraints before declaring manifest permissions.
- Keep tenant configuration isolated and authorize administration on
  the backend. Peer trust by URL does not grant configuration permissions.
- Local trace-helper creation or formatting failure handling remains
  proposed separately from the agreed incoming-context restart policy.

### Decisions still open

- Connection fields, configuration lifecycle, duplicate URL policy,
  updates, deletion, and stale Action selections: deliberately deferred
  until the user's prior connection work is available.
- JSON-RPC details: deferred to its reference. Trace carrier and restart
  policies are agreed; local trace-helper operational failure handling
  remains proposed.
- Exact delivery timeout, destination validation, and permitted egress.
  Verify budgets for the nested ping/pong HTTP calls against Forge limits;
  preserve a bounded acknowledgement path without reliability machinery.
- Limits: supported connection count, payload size, and concurrency.

Do not reopen connection-lifecycle, JSON-RPC, or logging-library design
questions before the corresponding prior work or references are ready.

## Testing Decisions

### Confirmed integration testing boundary

The JSON-RPC backbone over a web trigger makes the configuration flow
integration-testable without driving UI. Adopt that layer when its
reference implementation is available. Its methods and harness are not
specified here; do not invent a JSON-RPC event-delivery interface.

Using the Automation Action with two real installed sites is a manual
test and the demo, not an automated end-to-end test requirement.

No new tests are implemented by this draft. The repository has Vitest
configuration but no existing application test suite to use as prior art.

### Proposed automated coverage

- Test configuration through the JSON-RPC integration layer; defer its
  detailed mechanics until the reference is available.
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
- Check terminal pong handling, a single bounded delivery attempt,
  and acknowledgement despite failure to send pong.
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
- Peer authentication beyond possession of the target URL.
- Invitation pairing, automatic discovery, or arbitrary callback routing.
- Retries, duplicate suppression, durable queues, and delivery guarantees.
- An exchange-status dashboard or persistent event history.
- Automated two-real-site Automation end-to-end testing.
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

All active questions through Q20 are answered. Logging helpers are
available; the CloudEvents trace carrier and missing/invalid-context
restart policies are agreed. Only local helper-failure handling remains
proposed; it is not a new upstream library blocker.
Connection configuration and lifecycle remain deliberately deferred to
the user's prior work. JSON-RPC integration likewise waits for its
reference. Platform constraints and the remaining proposals must be
reconciled before approval; this is not a ready-to-build specification.
Do not start implementation until the deferred work is reconciled and
the user confirms shared understanding.

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
