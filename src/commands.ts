import { randomUUID } from "node:crypto";
import api from "@forge/api";
import { createTraceContext, formatTraceparent } from "@forge-ahead/logging";
import { kvs } from "@forge/kvs";

export type Connection = { id: string; name: string; eventUrl: string };
export type Commands = {
  "endpoint.get": (params: Record<string, never>) => { eventUrl: string };
  "connections.list": (params: Record<string, never>) => {
    connections: Connection[];
  };
  "connections.create": (params: { name: string; eventUrl: string }) => {
    connection: Connection;
  };
  "connections.delete": (params: { connectionId: string }) => {
    deleted: boolean;
  };
  "ping.send": (params: { connectionId: string }) => {
    delivered: true;
    pingId: string;
    traceId: string;
  };
};

const key = "peer-connections";
// KVS permits 240 KiB per value; this bounded collection must fit before writing.
const maxBytes = 240 * 1024;
const invalid = () => new CommandError(-32602, "Invalid params");
const failedStorage = () =>
  new CommandError(-32002, "Configuration unavailable");
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const shape = (
  value: unknown,
  fields: string[],
): value is Record<string, unknown> =>
  isRecord(value) &&
  Object.keys(value).length === fields.length &&
  fields.every((field) => Object.hasOwn(value, field));

async function read(): Promise<Connection[]> {
  let value: unknown;
  try {
    value = await kvs.get(key);
  } catch {
    throw failedStorage();
  }
  if (value === undefined) return [];
  if (
    !shape(value, ["connections"]) ||
    !Array.isArray(value["connections"]) ||
    value["connections"].length > 20 ||
    Buffer.byteLength(JSON.stringify(value), "utf8") >= maxBytes ||
    !value["connections"].every(
      (item: unknown) =>
        shape(item, ["id", "name", "eventUrl"]) &&
        typeof item["id"] === "string" &&
        item["id"].length > 0 &&
        typeof item["name"] === "string" &&
        item["name"] === item["name"].trim() &&
        [...item["name"]].length <= 100 &&
        typeof item["eventUrl"] === "string" &&
        Buffer.byteLength(item["eventUrl"], "utf8") <= 2048 &&
        destination(item["eventUrl"], ""),
    )
  )
    throw failedStorage();
  const connections = value["connections"] as Connection[];
  if (new Set(connections.map(({ id }) => id)).size !== connections.length)
    throw failedStorage();
  return connections;
}

async function save(connections: Connection[]): Promise<void> {
  if (Buffer.byteLength(JSON.stringify({ connections }), "utf8") >= maxBytes)
    throw invalid();
  try {
    await kvs.set(key, { connections });
  } catch {
    throw failedStorage();
  }
}

function destination(value: string, local: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !!url.hostname &&
      !url.username &&
      !url.password &&
      !value.slice(0, value.indexOf(url.host)).includes("@") &&
      !value.includes("?") &&
      !value.includes("#") &&
      value !== local
    );
  } catch {
    return false;
  }
}

export class CommandError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export function createCommands(getEventUrl: () => Promise<string>) {
  return async (method: string, params: unknown): Promise<unknown> => {
    if (
      ![
        "endpoint.get",
        "connections.list",
        "connections.create",
        "connections.delete",
        "ping.send",
      ].includes(method)
    )
      throw new CommandError(-32601, "Method not found");
    if (method === "endpoint.get" || method === "connections.list") {
      if (!shape(params, [])) throw invalid();
      return method === "endpoint.get"
        ? { eventUrl: await getEventUrl() }
        : { connections: await read() };
    }
    if (method === "ping.send") {
      if (
        !shape(params, ["connectionId"]) ||
        typeof params["connectionId"] !== "string" ||
        !params["connectionId"]
      )
        throw invalid();
      const connection = (await read()).find(
        ({ id }) => id === params["connectionId"],
      );
      if (!connection) throw invalid();
      const source = await getEventUrl();
      if (!destination(connection.eventUrl, source)) throw invalid();
      const trace = createTraceContext();
      if (trace.isErr()) throw new CommandError(-32003, "Ping delivery failed");
      const parent = formatTraceparent(trace.value);
      if (parent.isErr())
        throw new CommandError(-32003, "Ping delivery failed");
      const pingId = randomUUID();
      try {
        const response = await api.fetch(connection.eventUrl, {
          method: "POST",
          redirect: "manual",
          headers: { "Content-Type": "application/cloudevents+json" },
          body: JSON.stringify({
            specversion: "1.0",
            id: pingId,
            source,
            type: "ping",
            data: {},
            traceparent: parent.value,
          }),
        });
        if (response.status !== 204)
          throw new Error("Peer did not acknowledge ping");
      } catch {
        throw new CommandError(-32003, "Ping delivery failed");
      }
      return { delivered: true, pingId, traceId: trace.value.traceId };
    }
    if (method === "connections.delete") {
      if (
        !shape(params, ["connectionId"]) ||
        typeof params["connectionId"] !== "string" ||
        !params["connectionId"]
      )
        throw invalid();
      const connections = await read();
      const remaining = connections.filter(
        ({ id }) => id !== params["connectionId"],
      );
      if (remaining.length === connections.length) return { deleted: false };
      await save(remaining);
      return { deleted: true };
    }
    if (
      !shape(params, ["name", "eventUrl"]) ||
      typeof params["name"] !== "string" ||
      typeof params["eventUrl"] !== "string"
    )
      throw invalid();
    const name = params["name"].trim();
    const eventUrl = params["eventUrl"];
    if (
      !name ||
      [...name].length > 100 ||
      Buffer.byteLength(eventUrl, "utf8") > 2048 ||
      !destination(eventUrl, await getEventUrl())
    )
      throw invalid();
    const connections = await read();
    if (
      connections.length >= 20 ||
      connections.some(
        (connection) =>
          connection.name === name || connection.eventUrl === eventUrl,
      )
    )
      throw invalid();
    const connection = { id: randomUUID(), name, eventUrl };
    await save([...connections, connection]);
    return { connection };
  };
}
