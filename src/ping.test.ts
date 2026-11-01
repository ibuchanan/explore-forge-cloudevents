import { beforeEach, describe, expect, it, vi } from "vitest";

const { get, set, getUrl, fetch } = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  getUrl: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@forge/kvs", () => ({ kvs: { get, set } }));
vi.mock("@forge/api", () => ({
  webTrigger: { getUrl },
  default: { fetch, asUser: () => ({ requestJira: vi.fn() }) },
  route: (parts: TemplateStringsArray) => parts[0],
}));
vi.mock("@forge/resolver", () => ({ makeResolver: () => vi.fn() }));
vi.mock("@forge-ahead/logging", async (importOriginal) => {
  const actual =
    (await importOriginal()) as typeof import("@forge-ahead/logging");
  return {
    ...actual,
    createTraceContext: vi.fn(actual.createTraceContext),
    formatTraceparent: vi.fn(actual.formatTraceparent),
  };
});

import { createTraceContext, formatTraceparent } from "@forge-ahead/logging";
import { runRpc } from "./index";

const local = "https://local.example/event";
const peer = "https://peer.example/events/capability";
async function rpc(method: string, params: object = {}) {
  const result = await runRpc({
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    headers: { authorization: ["Bearer token"] },
    path: "",
    queryParameters: {},
  });
  return JSON.parse(result.body ?? "");
}

describe("authenticated ping.send RPC", () => {
  let stored: unknown;
  beforeEach(() => {
    stored = undefined;
    get.mockReset().mockImplementation(async () => stored);
    set.mockReset().mockImplementation(async (_key: string, value: unknown) => {
      stored = value;
    });
    getUrl.mockReset().mockResolvedValue(local);
    fetch.mockReset().mockResolvedValue({ status: 204 });
    vi.mocked(createTraceContext).mockClear();
    vi.mocked(formatTraceparent).mockClear();
    vi.stubEnv("RPC_BEARER_SECRET", "token");
  });

  it("sends one structured ping with a new trace and reports acknowledgement only", async () => {
    const created = await rpc("connections.create", {
      name: "Peer",
      eventUrl: peer,
    });
    const connectionId = created.result.connection.id;
    const sent = await rpc("ping.send", { connectionId });
    expect(sent.result).toEqual({
      delivered: true,
      pingId: expect.any(String),
      traceId: expect.stringMatching(/^[0-9a-f]{32}$/),
    });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls.at(0) ?? [];
    expect(url).toBe(peer);
    expect(options).toMatchObject({
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/cloudevents+json" },
    });
    expect(JSON.parse(options.body)).toEqual({
      specversion: "1.0",
      id: sent.result.pingId,
      source: local,
      type: "ping",
      data: {},
      traceparent: expect.stringMatching(
        new RegExp(`^00-${sent.result.traceId}-[0-9a-f]{16}-00$`),
      ),
    });
  });

  it("rejects a stored self-destination before any delivery", async () => {
    stored = { connections: [{ id: "self", name: "Self", eventUrl: local }] };
    const reply = await rpc("ping.send", { connectionId: "self" });
    expect(reply.error).toMatchObject({
      code: -32602,
      message: "Invalid params",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports non-204 and transport failures without retry or leaking the peer URL", async () => {
    const created = await rpc("connections.create", {
      name: "Peer",
      eventUrl: peer,
    });
    const connectionId = created.result.connection.id;
    fetch.mockResolvedValueOnce({ status: 302 });
    const redirect = await rpc("ping.send", { connectionId });
    expect(redirect.error).toMatchObject({
      code: -32003,
      message: "Ping delivery failed",
    });
    expect(JSON.stringify(redirect)).not.toContain(peer);
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockRejectedValueOnce(new Error(`Network failed: ${peer}`));
    const failed = await rpc("ping.send", { connectionId });
    expect(failed.error).toMatchObject({
      code: -32003,
      message: "Ping delivery failed",
    });
    expect(JSON.stringify(failed)).not.toContain(peer);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("fails before delivery when trace creation fails", async () => {
    const created = await rpc("connections.create", {
      name: "Peer",
      eventUrl: peer,
    });
    vi.mocked(createTraceContext).mockReturnValueOnce({
      isErr: () => true,
    } as never);
    const reply = await rpc("ping.send", {
      connectionId: created.result.connection.id,
    });
    expect(reply.error).toMatchObject({
      code: -32003,
      message: "Ping delivery failed",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails before delivery when trace formatting fails", async () => {
    const created = await rpc("connections.create", {
      name: "Peer",
      eventUrl: peer,
    });
    vi.mocked(formatTraceparent).mockReturnValueOnce({
      isErr: () => true,
    } as never);
    const reply = await rpc("ping.send", {
      connectionId: created.result.connection.id,
    });
    expect(reply.error).toMatchObject({
      code: -32003,
      message: "Ping delivery failed",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects unknown and deleted IDs before any delivery", async () => {
    expect(
      (await rpc("ping.send", { connectionId: "unknown" })).error.code,
    ).toBe(-32602);
    const created = await rpc("connections.create", {
      name: "Peer",
      eventUrl: peer,
    });
    await rpc("connections.delete", {
      connectionId: created.result.connection.id,
    });
    expect(
      (await rpc("ping.send", { connectionId: created.result.connection.id }))
        .error.code,
    ).toBe(-32602);
    expect(fetch).not.toHaveBeenCalled();
  });
});
