import type { WebTriggerRequest, WebTriggerResponse } from "@forge/api";
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
  if (parsed.data.type === "ping")
    console.info("peer ping accepted without reverse routing", {
      reason: "not-configured",
    });
  return { statusCode: 204 };
}
