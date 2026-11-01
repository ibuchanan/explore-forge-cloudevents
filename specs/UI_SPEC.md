# UI specification: cross-site event bridge administration

Status: approved by the user on 2026-10-25, consolidating decisions through
Q44. Overall app spec approved for implementation on 2026-11-01. Deployment
and installation require separate approval.

Behavior and protocol requirements remain in [the app spec](spec.md).
This document consolidates the agreed admin experience, not a new feature
set or an implementation plan.

## 1. Strategy and scope

- **User goal:** configure reciprocal peer connections and demonstrate a
  ping/pong exchange without confusing stored settings with connectivity.
- **Posture:** task-focused, auxiliary Jira administration.
- **Placement:** Configure and Get Started in Manage Apps, plus a persistent
  sidebar Status page. There is no issue panel.
- **Authorization:** every admin command checks Jira `ADMINISTER` on the
  backend. Visible navigation alone does not authorize an operation.
- **Shared behavior:** the typed resolver uses the same command dispatcher
  as protected JSON-RPC. No resolver-only configuration implementation.
- **Implementation:** both this document and the app spec are approved.
  Prefer Forge UI Kit and the Atlassian Design System; component and styling
  choices are not prescribed here.

Configuration, delivery acknowledgement, and round-trip completion are
separate observations. Pages do not infer remote reachability or reciprocal
configuration from local settings. Logs demonstrate the actual exchange.

## 2. Structure and skeleton

### Configure

**Hero:** the connection list and inline creation form.

Show the SDK-resolved local event URL with Copy, stored connections,
and an inline form with Name and URL. Each connection offers Send ping
and Delete. No edit, rename, enable/disable, or global reset control.

Connections have immutable IDs, names, and URLs. Trim names and require
non-empty, case-sensitive unique values. Validate URLs under the app spec's
HTTPS policy; no hostname allowlist or peer credentials are added here.
Changing any field requires deletion and creation with a fresh ID.

Interaction flow:
1. Load the local URL and configuration through shared read commands.
2. Enter a name and event URL and explicitly create the connection.
3. Show success only when the command acknowledges it. Creating or reading
   settings never contacts a peer.
4. Send ping only on an explicit per-connection action using `ping.send`.
   Success text is **"Ping delivery acknowledged"**, never "Connection
   healthy" or "Round trip successful".
5. Confirm deletion with a warning that saved Actions using the connection
   ID will fail. Deletion cannot cancel an already-resolved in-flight send.
6. Changing a destination requires selecting the new connection in saved
   Actions; creation never rebinds an old ID.

Do not log capability URLs, form payloads, or raw errors. Endpoint display
and copying by authorized admins are intentional; RPC secrets are never
returned or rendered.

### Get Started

**Hero:** a short setup-and-demo guide, not tracked onboarding.

Keep these instructions visible:
1. Install the same app on both sites.
2. Copy each installation's event URL.
3. Create reciprocal connections through Configure.
4. Add the Automation Action and select one connection.
5. Run the rule and inspect structured logs for ping/pong and trace
   correlation.

Include the local URL with Copy and links to Configure and Status. Show
whether local connections exist without claiming remote verification.
There is no persisted checklist, automatic probe, or separate Send ping
control. Do not require UI to perform configuration integration tests.

### Status

**Hero:** a read-only configuration summary.

Show **"No connections configured"** or **"N connections configured"**,
the local event URL with Copy, links to Configure and Get Started, and
Refresh. Refresh reloads configuration only. There is no Send ping,
health indicator, exchange history, or round-trip success claim.

## 3. State matrix

| Page        | Ideal                                                            | Empty                                                           | Loading                                                              | Error                                                                                                       |
| ----------- | ---------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Configure   | Show connections, creation form, and explicit row actions.       | Show "No connections configured" and the creation form.         | Show progress; disable connection actions until configuration loads. | Preserve entered values; show sanitized feedback and read-only refresh. Do not show a failed read as empty. |
| Get Started | Keep instructions visible and show local configuration presence. | Keep instructions and guide the admin to Configure.             | Keep instructions visible; show progress for local information.      | Keep instructions visible and show a distinct sanitized read error, not unconfigured status.                |
| Status      | Show the connection count, local URL, navigation, and Refresh.   | Show "No connections configured" with configuration navigation. | Show progress rather than empty/unconfigured state.                  | Show a sanitized read error rather than empty/unconfigured state.                                           |

### Busy and uncertain outcomes

- Show progress for Configure operations and prevent overlapping
  submissions from that page. The UI busy flag does not prevent another
  admin or RPC client from writing concurrently; this sample accepts that
  rare plain-KVS lost-update or duplicate-record risk.
- Preserve entered form values on failure. Do not show optimistic success.
- If create/delete loses its response, reload before resubmitting because
  the change may already have succeeded. If refresh also fails, the outcome
  remains unknown; do not pretend it was rolled back.
- If Send ping times out, do not retry automatically. The destination may
  already have received it. Do not label the exchange definitively absent.
- Unknown/deleted connection IDs fail without fallback. An already-resolved
  send may finish after deletion; subsequent attempts using that ID fail.
- No page load, refresh, save, or delete sends a ping or connectivity probe.

## 4. Edge cases and guardrails

- Validate name and URL uniqueness against the current collection for
  ordinary create requests. Concurrent admins or RPC clients can race in
  this sample; reload and correct any resulting configuration manually.
- Name matching is case-sensitive after trimming. IDs remain references;
  a same-name replacement is a different connection.
- Capability URLs may be long. Keep their actual values intact for Copy
  and exact matching; do not change or normalize them for presentation.
- Missing configuration is empty. Unreadable or malformed stored data is
  an error, not a reason to reseed or overwrite existing configuration.
- Missing or invalid authorization must not reveal configuration or
  permit commands. Expose only sanitized failures, never RPC credentials.
- No endpoint-health dashboard, saved onboarding progress, event ledger,
  proxy-specific configuration, or automatic network testing is introduced.
- Use clear labels, keyboard-operable controls, visible progress, and
  accessible feedback. Detailed layout and ADS component selection remain
  implementation details, subject to the approved behavioral contract.

## 5. Validation and evidence

Test public command behavior through the RPC integration interface where
possible. Separately test resolver authorization and UI states/interactions;
do not count those as evidence that RPC alone covers rendering or Forge
navigation. Manual two-site Automation and log inspection demonstrate the
complete concept. A successful `ping.send` proves only acknowledgement.

A deployed RPC verification script remains out of scope for this iteration.
