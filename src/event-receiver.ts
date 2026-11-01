import { randomUUID } from "node:crypto";
import api, {
  type WebTriggerRequest,
  type WebTriggerResponse,
  webTrigger,
} from "@forge/api";
import {
  createTraceContext,
  formatTraceparent,
  log,
  parseTraceparent,
  withLogContext,
} from "@forge-ahead/logging";
import { read } from "./commands";
import { peerEvent } from "./events";

const safeId = (value: string): string =>
  /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : "[redacted]";

const reject = (statusCode: number, reason: string): WebTriggerResponse => {
  console.info("peer event rejected", { reason });
  return { statusCode };
};

export async function receiveEvent(
  request: WebTriggerRequest,
): Promise<WebTriggerResponse> {
  if (request.method !== "POST") return reject(405, "method");
  const contentTypes = Object.entries(request.headers ?? {})
    .filter(([name]) => name.toLowerCase() === "content-type")
    .flatMap(([, values]) => values);
  if (
    contentTypes.length !== 1 ||
    !/^application\/cloudevents\+json(?:\s*;\s*charset=utf-8)?$/i.test(
      contentTypes[0] ?? "",
    )
  )
    return reject(415, "content-type");
  if (Buffer.byteLength(request.body, "utf8") > 16 * 1024)
    return reject(400, "size");
  let value: unknown;
  try {
    value = JSON.parse(request.body);
  } catch {
    return reject(400, "json");
  }
  const parsed = peerEvent.safeParse(value);
  if (!parsed.success) return reject(400, "event");
  const eventId = safeId(parsed.data.id);
  const pingId =
    parsed.data.type === "pong" ? safeId(parsed.data.data.pingId) : eventId;
  const incoming = parseTraceparent(parsed.data.traceparent);
  const trace = createTraceContext(
    incoming.isErr() ? {} : { parent: incoming.value },
  );
  if (trace.isErr()) {
    log.info({ eventId, reason: "trace-unavailable" }, "peer event skipped");
    return { statusCode: 204 };
  }
  return withLogContext({ ...trace.value }, async () => {
    if (incoming.isErr())
      log.info({ eventId, reason: "trace-restarted" }, "peer trace restarted");
    if (parsed.data.type === "pong") {
      log.info({ eventId, pingId }, "pong received");
      return { statusCode: 204 };
    }
    log.info({ eventId }, "ping received");
    try {
      const matches = (await read()).filter(
        ({ eventUrl }) => eventUrl === parsed.data.source,
      );
      if (matches.length !== 1) {
        log.info(
          {
            eventId,
            reason: matches.length ? "ambiguous" : "no-reverse-connection",
          },
          "peer pong skipped",
        );
      } else {
        const parent = formatTraceparent(trace.value);
        if (parent.isErr()) {
          log.info(
            { eventId, reason: "trace-unavailable" },
            "peer pong skipped",
          );
          return { statusCode: 204 };
        }
        const source = await webTrigger.getUrl("peer-event");
        const connection = matches[0];
        if (!connection) throw new Error("reverse connection unavailable");
        const pongId = randomUUID();
        try {
          const response = await api.fetch(connection.eventUrl, {
            method: "POST",
            redirect: "manual",
            headers: { "Content-Type": "application/cloudevents+json" },
            body: JSON.stringify({
              specversion: "1.0",
              id: pongId,
              source,
              type: "pong",
              data: { pingId: parsed.data.id },
              traceparent: parent.value,
            }),
          });
          if (response.status !== 204) throw new Error("pong not acknowledged");
          log.info(
            { eventId: pongId, pingId, connectionId: connection.id },
            "pong sent",
          );
        } catch {
          log.info(
            {
              eventId: pongId,
              pingId,
              connectionId: connection.id,
              reason: "delivery-unavailable",
            },
            "peer pong skipped",
          );
        }
      }
    } catch {
      log.info(
        { eventId, reason: "delivery-unavailable" },
        "peer pong skipped",
      );
    }
    return { statusCode: 204 };
  });
}
