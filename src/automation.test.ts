import { beforeEach, describe, expect, it, vi } from "vitest";

const { get, getUrl, fetch } = vi.hoisted(() => ({
  get: vi.fn(),
  getUrl: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@forge/kvs", () => ({ kvs: { get } }));
vi.mock("@forge/api", () => ({
  default: { fetch },
  webTrigger: { getUrl },
}));
vi.mock("@forge/resolver", () => ({
  makeResolver: (handlers: unknown) => handlers,
}));

import { automationResolver, runAutomationPing, runRpc } from "./index";

const connection = {
  id: "peer-1",
  name: "Peer",
  eventUrl: "https://peer.example/event",
};

describe("Automation ping action", () => {
  beforeEach(() => {
    get.mockReset().mockResolvedValue({ connections: [connection] });
    getUrl.mockReset().mockResolvedValue("https://local.example/event");
    fetch.mockReset().mockResolvedValue({ status: 204 });
    vi.stubEnv("RPC_BEARER_SECRET", "");
  });

  it("acknowledges one selected connection without waiting for pong or requiring RPC bearer", async () => {
    const result = await runAutomationPing({ connectionId: connection.id });
    expect(result).toEqual({
      delivered: true,
      pingId: expect.any(String),
      traceId: expect.any(String),
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toBe(connection.eventUrl);
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body).type).toBe("ping");
  });

  it("lists stable IDs for the rule-author selector without accepting caller identity", async () => {
    const resolver = automationResolver as unknown as Record<
      string,
      (request: { payload: unknown }) => Promise<unknown>
    >;
    expect(await resolver["connections.list"]?.({ payload: {} })).toEqual({
      connections: [{ id: connection.id, name: connection.name }],
    });
    expect(get).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    await expect(
      resolver["connections.list"]?.({ payload: { accountId: "other" } }),
    ).rejects.toThrow("Invalid params");
  });

  it("rejects stale IDs and malformed inputs without fallback or delivery", async () => {
    for (const payload of [
      { connectionId: "deleted" },
      { connectionId: "" },
      { connectionId: connection.id, eventUrl: "https://attacker.example" },
    ]) {
      expect(await runAutomationPing(payload)).toEqual({
        errors: [{ message: "Invalid params" }],
      });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends the same wire contract as protected RPC for the same connection", async () => {
    vi.stubEnv("RPC_BEARER_SECRET", "token");
    const rpc = await runRpc({
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "ping.send",
        params: { connectionId: connection.id },
      }),
      headers: { authorization: ["Bearer token"] },
      path: "",
      queryParameters: {},
    });
    const action = await runAutomationPing({ connectionId: connection.id });
    expect(JSON.parse(rpc.body ?? "").result).toMatchObject({
      delivered: true,
      pingId: expect.any(String),
      traceId: expect.any(String),
    });
    expect(action).toMatchObject({
      delivered: true,
      pingId: expect.any(String),
      traceId: expect.any(String),
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    const [fromRpc, fromAction] = fetch.mock.calls.map(([, options]) => ({
      url: options.redirect,
      method: options.method,
      headers: options.headers,
      event: JSON.parse(options.body),
    }));
    expect(fromRpc).toMatchObject({
      method: "POST",
      url: "manual",
      event: { type: "ping", source: "https://local.example/event", data: {} },
    });
    expect(fromAction).toMatchObject({
      method: fromRpc?.method,
      url: fromRpc?.url,
      headers: fromRpc?.headers,
      event: {
        type: fromRpc?.event.type,
        source: fromRpc?.event.source,
        data: fromRpc?.event.data,
      },
    });
  });

  it("reports unavailable configuration and unexpected errors without exposing details", async () => {
    get.mockRejectedValueOnce(new Error(`Storage at ${connection.eventUrl}`));
    expect(await runAutomationPing({ connectionId: connection.id })).toEqual({
      errors: [{ message: "Configuration unavailable" }],
    });
    getUrl.mockRejectedValueOnce(new Error(`URL at ${connection.eventUrl}`));
    expect(await runAutomationPing({ connectionId: connection.id })).toEqual({
      errors: [{ message: "Internal error" }],
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns sanitized failure for delivery errors without retry", async () => {
    fetch.mockRejectedValueOnce(new Error(`Secret at ${connection.eventUrl}`));
    const result = await runAutomationPing({ connectionId: connection.id });
    expect(result).toEqual({ errors: [{ message: "Ping delivery failed" }] });
    expect(JSON.stringify(result)).not.toContain(connection.eventUrl);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
