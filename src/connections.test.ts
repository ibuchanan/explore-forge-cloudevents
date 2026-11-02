import { beforeEach, describe, expect, it, vi } from "vitest";

const { get, set, getUrl, requestJira } = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  getUrl: vi.fn(),
  requestJira: vi.fn(),
}));
const handlers = vi.hoisted(() => ({
  definitions: {} as Record<
    string,
    (request: { payload: unknown }) => Promise<unknown>
  >,
}));
vi.mock("@forge/kvs", () => ({ kvs: { get, set } }));
vi.mock("@forge/api", () => ({
  webTrigger: { getUrl },
  default: { asUser: () => ({ requestJira }) },
  route: (parts: TemplateStringsArray) => parts[0],
}));
vi.mock("@forge/resolver", () => ({
  makeResolver: (definitions: typeof handlers.definitions) => {
    if ("endpoint.get" in definitions) handlers.definitions = definitions;
    return definitions;
  },
}));

import { adminResolver, runRpc } from "./index";

const url = "https://peer.example/events/opaque-path";
async function rpc(
  method: string,
  params: object = {},
  token = "Bearer token",
) {
  const response = await runRpc({
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    headers: { authorization: [token] },
    path: "",
    queryParameters: {},
  });
  return { status: response.statusCode, ...JSON.parse(response.body ?? "") };
}

describe("protected connection commands", () => {
  let stored: unknown;
  beforeEach(() => {
    stored = undefined;
    get.mockReset().mockImplementation(async () => stored);
    set.mockReset().mockImplementation(async (_key: string, value: unknown) => {
      stored = value;
    });
    getUrl.mockReset().mockResolvedValue("https://local.example/events");
    requestJira.mockReset().mockResolvedValue({
      ok: true,
      json: async () => ({
        permissions: { ADMINISTER: { havePermission: true } },
      }),
    });
    vi.stubEnv("RPC_BEARER_SECRET", "token");
  });

  it("creates, lists and idempotently deletes a connection through authenticated RPC", async () => {
    expect((await rpc("connections.list")).result).toEqual({ connections: [] });
    const created = (
      await rpc("connections.create", { name: " Peer ", eventUrl: url })
    ).result.connection;
    expect(created).toEqual({
      id: expect.any(String),
      name: "Peer",
      eventUrl: url,
    });
    expect(created.id).not.toBe("");
    expect((await rpc("connections.list")).result).toEqual({
      connections: [created],
    });
    expect(
      (await rpc("connections.delete", { connectionId: created.id })).result,
    ).toEqual({ deleted: true });
    expect(
      (await rpc("connections.delete", { connectionId: created.id })).result,
    ).toEqual({ deleted: false });
    expect((await rpc("connections.list")).result).toEqual({ connections: [] });
    expect(getUrl).toHaveBeenCalledWith("peer-event");
    expect(set).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid and duplicate configuration without changing storage", async () => {
    const create = (name: unknown, eventUrl: unknown) =>
      rpc("connections.create", { name, eventUrl });
    const first = await create("Peer", url);
    expect(first.result.connection.name).toBe("Peer");
    const saved = set.mock.calls.length;
    for (const [name, eventUrl] of [
      ["  ", `${url}2`],
      ["Peer", `${url}2`],
      ["Another", url],
      ["Over", "http://peer.example/event"],
      ["Over", "https://user:pass@peer.example/event"],
      ["Over", `${url}?token=abc`],
      ["Over", `${url}#fragment`],
      ["Over", `${url}?`],
      ["Over", `${url}#`],
      ["Over", "https://@peer.example/events"],
      ["Over", "https://local.example/events"],
      ["Over", "not a URL"],
      ["x".repeat(101), `${url}2`],
      ["😀".repeat(101), `${url}2`],
      ["Over", `https://peer.example/${"a".repeat(2049)}`],
    ] as const) {
      expect((await create(name, eventUrl)).error).toEqual({
        code: -32602,
        message: "Invalid params",
      });
    }
    expect(set).toHaveBeenCalledTimes(saved);
    expect((await create("peer", `${url}2`)).result.connection.name).toBe(
      "peer",
    );
    expect(
      (
        await rpc("connections.create", {
          name: "a",
          eventUrl: url,
          extra: true,
        })
      ).error.code,
    ).toBe(-32602);
    expect(
      (await rpc("connections.delete", { connectionId: "" })).error.code,
    ).toBe(-32602);
  });

  it("rejects malformed or oversized stored documents without overwriting", async () => {
    for (const value of [
      null,
      {
        connections: [
          { id: "same", name: "Peer", eventUrl: url },
          { id: "same", name: "Other", eventUrl: `${url}2` },
        ],
      },
      {
        connections: [
          { id: "id", name: "Peer", eventUrl: "http://peer.example/" },
        ],
      },
      { connections: [{ id: "id", name: "Peer", eventUrl: url, extra: true }] },
      { connections: [{ id: "id", name: "x".repeat(101), eventUrl: url }] },
      {
        connections: [
          {
            id: "id",
            name: "Peer",
            eventUrl: `https://peer.example/${"x".repeat(2049)}`,
          },
        ],
      },
    ]) {
      stored = value;
      expect((await rpc("connections.list")).error).toEqual({
        code: -32002,
        message: "Configuration unavailable",
      });
    }
    expect(set).not.toHaveBeenCalled();
  });

  it("keeps failed and malformed storage distinct from an empty installation", async () => {
    get.mockRejectedValueOnce(new Error("secret read error"));
    expect((await rpc("connections.list")).error).toEqual({
      code: -32002,
      message: "Configuration unavailable",
    });
    stored = { connections: [{ id: 1, name: "oops", eventUrl: url }] };
    expect((await rpc("connections.list")).error).toEqual({
      code: -32002,
      message: "Configuration unavailable",
    });
    expect(
      (await rpc("connections.create", { name: "Peer", eventUrl: url })).error,
    ).toEqual({ code: -32002, message: "Configuration unavailable" });
    expect(set).not.toHaveBeenCalled();
  });

  it("returns sanitized write errors without claiming a connection was saved", async () => {
    set.mockRejectedValueOnce(new Error("storage provider leaked secret"));
    expect(
      (await rpc("connections.create", { name: "Peer", eventUrl: url })).error,
    ).toEqual({ code: -32002, message: "Configuration unavailable" });
    expect((await rpc("connections.list")).result).toEqual({ connections: [] });
  });

  it("dispatches each admin method only after a fresh permission check", async () => {
    const created = await handlers.definitions["connections.create"]?.({
      payload: { name: "Peer", eventUrl: url },
    });
    expect(created).toEqual({
      connection: { id: expect.any(String), name: "Peer", eventUrl: url },
    });
    const connection = (
      created as { connection: { id: string; name: string; eventUrl: string } }
    ).connection;
    expect(
      await handlers.definitions["connections.list"]?.({ payload: {} }),
    ).toEqual({ connections: [connection] });
    expect(
      await handlers.definitions["connections.delete"]?.({
        payload: { connectionId: connection.id },
      }),
    ).toEqual({ deleted: true });
    expect(requestJira).toHaveBeenCalledTimes(3);
  });

  it("enforces the connection count and preserves exact capability URLs", async () => {
    for (let i = 0; i < 20; i++) {
      const eventUrl = `${url}/${i}`;
      expect(
        (await rpc("connections.create", { name: `Peer ${i}`, eventUrl }))
          .result.connection.eventUrl,
      ).toBe(eventUrl);
    }
    expect(
      (
        await rpc("connections.create", {
          name: "Peer 20",
          eventUrl: `${url}/20`,
        })
      ).error.code,
    ).toBe(-32602);
    expect(set).toHaveBeenCalledTimes(20);
  });

  it("refuses unauthorized writes and guards each admin resolver call", async () => {
    expect(
      (
        await rpc(
          "connections.create",
          { name: "Peer", eventUrl: url },
          "Bearer wrong",
        )
      ).status,
    ).toBe(401);
    expect(adminResolver).toBe(handlers.definitions);
    requestJira.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        permissions: { ADMINISTER: { havePermission: false } },
      }),
    });
    await expect(
      handlers.definitions["connections.create"]?.({
        payload: { name: "Peer", eventUrl: url },
      }),
    ).rejects.toThrow("Forbidden");
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });
});
