import { timingSafeEqual } from "node:crypto";
import type { WebTriggerRequest, WebTriggerResponse } from "@forge/api";
import { CommandError } from "./commands";

const response = (
  id: string | number | null,
  value: { result: unknown } | { error: { code: number; message: string } },
  statusCode = 200,
): WebTriggerResponse => ({
  statusCode,
  headers: { "Content-Type": ["application/json"] },
  body: JSON.stringify({ jsonrpc: "2.0", id, ...value }),
});
const failure = (
  id: string | number | null,
  code: number,
  message: string,
  statusCode = 200,
) => response(id, { error: { code, message } }, statusCode);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function validRequest(value: unknown): value is {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
  id: string | number;
} {
  return (
    isRecord(value) &&
    Object.keys(value).length === 4 &&
    value["jsonrpc"] === "2.0" &&
    typeof value["method"] === "string" &&
    value["method"].length > 0 &&
    isRecord(value["params"]) &&
    (typeof value["id"] === "string" ||
      (typeof value["id"] === "number" && Number.isFinite(value["id"])))
  );
}

function authorized(
  headers: Record<string, string[]>,
  secret: string | undefined,
): boolean {
  if (!secret) return false;
  const values = Object.entries(headers)
    .filter(([name]) => name.toLowerCase() === "authorization")
    .flatMap(([, values]) => values);
  if (values.length !== 1 || !values[0]?.startsWith("Bearer ")) return false;
  const provided = values[0].slice(7);
  const expectedBytes = Buffer.from(secret);
  const providedBytes = Buffer.from(provided);
  return (
    expectedBytes.length === providedBytes.length &&
    timingSafeEqual(expectedBytes, providedBytes)
  );
}

export function createRpcHandler(
  dispatch: (method: string, params: unknown) => Promise<unknown>,
  getSecret: () => string | undefined,
) {
  return async (request: WebTriggerRequest): Promise<WebTriggerResponse> => {
    if (!authorized(request.headers ?? {}, getSecret()))
      return failure(null, -32001, "Unauthorized", 401);
    if (request.method !== "POST")
      return failure(null, -32600, "Invalid Request", 405);
    let value: unknown;
    try {
      value = JSON.parse(request.body);
    } catch {
      return failure(null, -32700, "Parse error", 400);
    }
    if (!validRequest(value))
      return failure(null, -32600, "Invalid Request", 400);
    try {
      return response(value["id"], {
        result: await dispatch(value["method"], value["params"]),
      });
    } catch (error) {
      if (error instanceof CommandError)
        return failure(value["id"], error.code, error.message);
      return failure(value["id"], -32603, "Internal error", 500);
    }
  };
}
