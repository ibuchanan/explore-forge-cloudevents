import { describe, expect, it, vi } from "vitest";
import { createRpcHandler } from "./rpc";

const rpc = (
  value: unknown,
  headers: Record<string, string[]> = { Authorization: ["Bearer secret"] },
) => ({
  method: "POST" as const,
  body: JSON.stringify(value),
  path: "/rpc",
  headers,
  queryParameters: {},
});
const call = { jsonrpc: "2.0", method: "endpoint.get", params: {}, id: 1 };

describe("protected JSON-RPC HTTP adapter", () => {
  const setup = (secret: string | undefined) => {
    const dispatch = vi
      .fn()
      .mockResolvedValue({ eventUrl: "https://example.test/events" });
    const handle = createRpcHandler(dispatch, () => secret);
    return { handle, dispatch };
  };

  it("dispatches a single authenticated request without exposing credentials", async () => {
    const { handle, dispatch } = setup("secret");
    const response = await handle(rpc(call));
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "")).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { eventUrl: "https://example.test/events" },
    });
    expect(JSON.stringify(response)).not.toContain("secret");
    expect(dispatch).toHaveBeenCalledWith("endpoint.get", {});
  });

  it.each([undefined, "", "wrong"])(
    "fails closed with secret %s",
    async (secret) => {
      const { handle, dispatch } = setup(secret);
      const response = await handle(rpc(call));
      expect(response.statusCode).toBe(401);
      expect(dispatch).not.toHaveBeenCalled();
    },
  );

  it.each([
    {},
    { authorization: ["Bearer wrong"] },
    { Authorization: ["Bearer secret", "Bearer secret"] },
    { Authorization: ["Basic secret"] },
  ])("rejects missing/invalid authorization %j", async (headers) => {
    const { handle, dispatch } = setup("secret");
    expect(
      (await handle(rpc(call, headers as Record<string, string[]>))).statusCode,
    ).toBe(401);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([
    [[call, call]],
    { ...call, id: null },
    { ...call, id: Number.POSITIVE_INFINITY },
    { ...call, id: true },
    { ...call, id: {} },
    { ...call, params: [] },
    { ...call, params: null },
    { ...call, params: "" },
    { ...call, jsonrpc: "1.0" },
    { ...call, extra: true },
    { jsonrpc: "2.0", method: "endpoint.get", params: {} },
  ])("rejects malformed calls without dispatching: %j", async (request) => {
    const { handle, dispatch } = setup("secret");
    const response = await handle(rpc(request));
    expect(JSON.parse(response.body ?? "")).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid Request" },
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("sanitizes bad JSON, command errors, and unexpected exceptions", async () => {
    const { handle, dispatch } = setup("secret");
    expect(
      JSON.parse((await handle({ ...rpc(call), body: "{" })).body ?? "").error,
    ).toEqual({ code: -32700, message: "Parse error" });
    dispatch.mockRejectedValueOnce(
      new Error("private-secret https://internal.test"),
    );
    const error = JSON.parse((await handle(rpc(call))).body ?? "");
    expect(error.error).toEqual({ code: -32603, message: "Internal error" });
    expect(JSON.stringify(error)).not.toContain("private-secret");
  });
});
