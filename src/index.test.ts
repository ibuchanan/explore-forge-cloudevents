import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUrl, requestJira } = vi.hoisted(() => ({
  getUrl: vi.fn(),
  requestJira: vi.fn(),
}));
const handlers = vi.hoisted(() => ({
  definitions: {} as Record<
    string,
    (request: { payload: unknown }) => Promise<unknown>
  >,
}));
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

import { adminResolver, runEvent, runRpc } from "./index";

const rpcRequest = {
  method: "POST" as const,
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: "a",
    method: "endpoint.get",
    params: {},
  }),
  headers: { authorization: ["Bearer token"] },
  path: "",
  queryParameters: {},
};

const eventRequest = {
  method: "POST" as const,
  body: JSON.stringify({
    specversion: "1.0",
    id: "event-1",
    source: "https://peer.example/event",
    type: "ping",
    data: {},
  }),
  headers: { "content-type": ["application/cloudevents+json"] },
  path: "",
  queryParameters: {},
};

describe("public peer-event HTTP receiver", () => {
  it("acknowledges valid ping and terminal pong without requiring RPC credentials", async () => {
    vi.stubEnv("RPC_BEARER_SECRET", "");
    for (const event of [
      JSON.parse(eventRequest.body),
      {
        ...JSON.parse(eventRequest.body),
        type: "pong",
        data: { pingId: "ping-1" },
      },
    ]) {
      expect(
        await runEvent({ ...eventRequest, body: JSON.stringify(event) }),
      ).toEqual({
        statusCode: 204,
      });
    }
  });
  it("rejects invalid HTTP envelopes without dispatching or disclosing their contents", async () => {
    const event = JSON.parse(eventRequest.body);
    const cases = [
      [{ ...eventRequest, method: "GET" as const }, 405],
      [{ ...eventRequest, headers: {} }, 415],
      [
        { ...eventRequest, headers: { "Content-Type": ["application/json"] } },
        415,
      ],
      [
        {
          ...eventRequest,
          headers: {
            "content-type": [
              "application/cloudevents+json",
              "application/cloudevents+json",
            ],
          },
        },
        415,
      ],
      [{ ...eventRequest, body: "{" }, 400],
      [{ ...eventRequest, body: "[]" }, 400],
      [
        { ...eventRequest, body: JSON.stringify({ ...event, type: "other" }) },
        400,
      ],
      [
        {
          ...eventRequest,
          body: JSON.stringify({ ...event, data: { unexpected: true } }),
        },
        400,
      ],
      [
        {
          ...eventRequest,
          body: JSON.stringify({ ...event, type: "pong", data: {} }),
        },
        400,
      ],
      [
        {
          ...eventRequest,
          body: JSON.stringify({ ...event, source: "http://[" }),
        },
        400,
      ],
      [
        {
          ...eventRequest,
          body: JSON.stringify({ ...event, specversion: "0.3" }),
        },
        400,
      ],
      [
        {
          ...eventRequest,
          body: JSON.stringify({ ...event, extra: "unsupported" }),
        },
        400,
      ],
      [
        {
          ...eventRequest,
          body: JSON.stringify({
            ...event,
            data: { padding: "é".repeat(8192) },
          }),
        },
        400,
      ],
    ] satisfies Array<[Parameters<typeof runEvent>[0], number]>;
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      for (const [request, statusCode] of cases) {
        expect(await runEvent(request)).toEqual({ statusCode });
      }
      expect(getUrl).not.toHaveBeenCalled();
      expect(requestJira).not.toHaveBeenCalled();
      expect(JSON.stringify(log.mock.calls)).not.toContain(
        "https://peer.example/event",
      );
      expect(JSON.stringify(log.mock.calls)).not.toContain("padding");
    } finally {
      log.mockRestore();
    }
  });
  it("accepts a relative CloudEvents source URI-reference", async () => {
    const event = { ...JSON.parse(eventRequest.body), source: "/peer" };
    expect(
      await runEvent({ ...eventRequest, body: JSON.stringify(event) }),
    ).toEqual({
      statusCode: 204,
    });
  });
  it("accepts optional untrusted trace metadata without echoing it", async () => {
    const event = {
      ...JSON.parse(eventRequest.body),
      traceparent: "invalid-trace",
    };
    expect(
      await runEvent({ ...eventRequest, body: JSON.stringify(event) }),
    ).toEqual({
      statusCode: 204,
    });
  });
});

describe("Forge handler wiring", () => {
  beforeEach(() => {
    vi.stubEnv("RPC_BEARER_SECRET", "token");
    getUrl.mockReset().mockResolvedValue("https://example.test/event");
    requestJira.mockReset().mockResolvedValue({
      ok: true,
      json: async () => ({
        permissions: { ADMINISTER: { havePermission: true } },
      }),
    });
  });
  it("routes RPC to the SDK event URL, not the RPC URL", async () => {
    const response = await runRpc(rpcRequest);
    expect(JSON.parse(response.body ?? "").result).toEqual({
      eventUrl: "https://example.test/event",
    });
    expect(getUrl).toHaveBeenCalledWith("peer-event");
  });
  it("guards typed resolver using Jira ADMINISTER for every call", async () => {
    expect(adminResolver).toBe(handlers.definitions);
    expect(
      await handlers.definitions["endpoint.get"]?.({ payload: {} }),
    ).toEqual({ eventUrl: "https://example.test/event" });
    expect(requestJira).toHaveBeenCalledWith(
      "/rest/api/3/mypermissions?permissions=ADMINISTER",
    );
    requestJira.mockRejectedValueOnce(
      new Error("permission check unavailable"),
    );
    await expect(
      handlers.definitions["endpoint.get"]?.({ payload: {} }),
    ).rejects.toThrow("Forbidden");
    expect(getUrl).toHaveBeenCalledOnce();
  });
});
