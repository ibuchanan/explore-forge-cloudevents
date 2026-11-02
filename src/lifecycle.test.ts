import { beforeEach, describe, expect, it, vi } from "vitest";

const { get, set, del, fetch } = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@forge/kvs", () => ({ kvs: { get, set, delete: del } }));
vi.mock("@forge/api", () => ({
  default: { fetch },
  webTrigger: { getUrl: vi.fn() },
  route: (parts: TemplateStringsArray) => parts[0],
}));
vi.mock("@forge/resolver", () => ({
  makeResolver: (methods: unknown) => methods,
}));

import { read } from "./commands";
import { onInstalled, onUpgraded, onPreUninstall } from "./index";

const connection = {
  id: "peer-1",
  name: "Peer",
  eventUrl: "https://peer.example/events/opaque-path",
};

describe("installation lifecycle", () => {
  let stored: unknown;
  beforeEach(() => {
    stored = undefined;
    get.mockReset().mockImplementation(async () => stored);
    set.mockReset().mockImplementation(async (_key: string, value: unknown) => {
      stored = value;
    });
    del.mockReset().mockImplementation(async () => {
      stored = undefined;
    });
    fetch.mockReset();
  });

  it("seeds only an absent installation, preserving configuration on repeated install and upgrade", async () => {
    expect(await read()).toEqual([]);
    expect(set).not.toHaveBeenCalled();

    await onInstalled();
    expect(set).toHaveBeenCalledExactlyOnceWith("peer-connections", {
      connections: [],
    });
    expect(await read()).toEqual([]);

    stored = { connections: [connection] };
    await onInstalled();
    await onUpgraded();
    expect(await read()).toEqual([connection]);
    expect(set).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not overwrite failed reads or malformed stored records", async () => {
    get.mockRejectedValueOnce(new Error("secret storage failure"));
    await expect(onInstalled()).rejects.toThrow("Configuration unavailable");
    stored = { connections: [{ id: 1, name: "invalid" }] };
    await expect(onUpgraded()).rejects.toThrow("Configuration unavailable");
    expect(set).not.toHaveBeenCalled();
    await expect(read()).rejects.toThrow("Configuration unavailable");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("attempts local deletion on pre-uninstall without contacting peers or touching runtime secrets", async () => {
    stored = { connections: [connection] };
    vi.stubEnv("RPC_BEARER_SECRET", "private-runtime-secret");
    await onPreUninstall();
    expect(del).toHaveBeenCalledExactlyOnceWith("peer-connections");
    expect(await read()).toEqual([]);
    expect(process.env["RPC_BEARER_SECRET"]).toBe("private-runtime-secret");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("logs only a sanitized cleanup failure and does not block uninstall", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    del.mockRejectedValueOnce(
      new Error("secret https://peer.example/events/opaque-path"),
    );
    try {
      await expect(onPreUninstall()).resolves.toBeUndefined();
      expect(JSON.stringify(spy.mock.calls)).toContain(
        "connection cleanup failed",
      );
      expect(JSON.stringify(spy.mock.calls)).not.toContain("peer.example");
      expect(JSON.stringify(spy.mock.calls)).not.toContain("secret https");
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
