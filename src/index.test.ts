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
    handlers.definitions = definitions;
    return definitions;
  },
}));

import { adminResolver, runRpc } from "./index";

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
