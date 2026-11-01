import { randomUUID } from "node:crypto";
import api, {
  type WebTriggerRequest,
  type WebTriggerResponse,
  webTrigger,
} from "@forge/api";
import { createTraceContext, formatTraceparent } from "@forge-ahead/logging";
import { read } from "./commands";
import { peerEvent } from "./events";

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
  if (parsed.data.type === "ping") {
    try {
      const matches = (await read()).filter(
        ({ eventUrl }) => eventUrl === parsed.data.source,
      );
      if (matches.length !== 1) {
        console.info("peer pong skipped", {
          reason: matches.length ? "ambiguous" : "no-reverse-connection",
        });
      } else {
        const trace = createTraceContext();
        if (trace.isErr()) throw new Error("trace creation failed");
        const parent = formatTraceparent(trace.value);
        if (parent.isErr()) throw new Error("trace formatting failed");
        const source = await webTrigger.getUrl("peer-event");
        const connection = matches[0];
        if (!connection) throw new Error("reverse connection unavailable");
        const response = await api.fetch(connection.eventUrl, {
          method: "POST",
          redirect: "manual",
          headers: { "Content-Type": "application/cloudevents+json" },
          body: JSON.stringify({
            specversion: "1.0",
            id: randomUUID(),
            source,
            type: "pong",
            data: { pingId: parsed.data.id },
            traceparent: parent.value,
          }),
        });
        if (response.status !== 204) throw new Error("pong not acknowledged");
      }
    } catch {
      console.info("peer pong skipped", { reason: "delivery-unavailable" });
    }
  }
  return { statusCode: 204 };
}
