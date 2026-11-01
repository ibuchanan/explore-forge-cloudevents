import { beforeEach, describe, expect, it, vi } from "vitest";

const { get, fetch, getUrl } = vi.hoisted(() => ({
  get: vi.fn(),
  fetch: vi.fn(),
  getUrl: vi.fn(),
}));
vi.mock("@forge/kvs", () => ({ kvs: { get } }));
vi.mock("@forge/api", () => ({
  webTrigger: { getUrl },
  default: { fetch, asUser: () => ({ requestJira: vi.fn() }) },
  route: (parts: TemplateStringsArray) => parts[0],
}));
vi.mock("@forge/resolver", () => ({ makeResolver: () => vi.fn() }));

import { runEvent } from "./index";

const peer = "https://peer.example/event/opaque";
const local = "https://local.example/event";
const ping = {
  specversion: "1.0",
  id: "ping-1",
  source: peer,
  type: "ping",
  data: {},
};
const request = (event: object) => ({
  method: "POST" as const,
  body: JSON.stringify(event),
  headers: { "content-type": ["application/cloudevents+json"] },
  path: "",
  queryParameters: {},
});
const connection = (id: string, eventUrl: string) => ({
  id,
  name: id,
  eventUrl,
});

describe("peer event receiver pong routing", () => {
  beforeEach(() => {
    get
      .mockReset()
      .mockResolvedValue({ connections: [connection("reverse", peer)] });
    fetch.mockReset().mockResolvedValue({ status: 204 });
    getUrl.mockReset().mockResolvedValue(local);
  });

  it("routes an accepted ping to its exact reverse connection once", async () => {
    expect(await runEvent(request(ping))).toEqual({ statusCode: 204 });
    expect(get).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(peer);
    expect(options).toMatchObject({
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/cloudevents+json" },
    });
    const pong = JSON.parse(options.body);
    expect(pong).toMatchObject({
      specversion: "1.0",
      source: local,
      type: "pong",
      data: { pingId: ping.id },
    });
    expect(pong.id).toEqual(expect.any(String));
    expect(pong.id).not.toBe(ping.id);
    expect(JSON.stringify(options)).not.toContain("Bearer");
  });

  it("does not send when no reverse connection exactly matches", async () => {
    get.mockResolvedValue({ connections: [connection("other", `${peer}/`)] });
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      expect(await runEvent(request(ping))).toEqual({ statusCode: 204 });
      expect(fetch).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith("peer pong skipped", {
        reason: "no-reverse-connection",
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain(peer);
    } finally {
      log.mockRestore();
    }
  });

  it("does not guess between duplicate reverse connections", async () => {
    get.mockResolvedValue({
      connections: [connection("a", peer), connection("b", peer)],
    });
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      expect(await runEvent(request(ping))).toEqual({ statusCode: 204 });
      expect(fetch).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith("peer pong skipped", {
        reason: "ambiguous",
      });
    } finally {
      log.mockRestore();
    }
  });

  it("acknowledges ping despite one failed delivery without exposing peer details", async () => {
    fetch.mockRejectedValue(new Error(`private: ${peer} Bearer secret`));
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      expect(await runEvent(request(ping))).toEqual({ statusCode: 204 });
      expect(fetch).toHaveBeenCalledOnce();
      expect(log).toHaveBeenCalledWith("peer pong skipped", {
        reason: "delivery-unavailable",
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain(peer);
      expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
    } finally {
      log.mockRestore();
    }
  });

  it("acknowledges a valid ping when configuration cannot be read", async () => {
    get.mockRejectedValue(new Error(`private: ${peer}`));
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      expect(await runEvent(request(ping))).toEqual({ statusCode: 204 });
      expect(fetch).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith("peer pong skipped", {
        reason: "delivery-unavailable",
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain(peer);
    } finally {
      log.mockRestore();
    }
  });

  it("does not follow a redirect or retry a rejected pong", async () => {
    fetch.mockResolvedValue({ status: 302 });
    expect(await runEvent(request(ping))).toEqual({ statusCode: 204 });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[1].redirect).toBe("manual");
  });

  it("rejects invalid events before reading connections or sending", async () => {
    expect(await runEvent(request({ ...ping, data: { extra: true } }))).toEqual(
      { statusCode: 400 },
    );
    expect(get).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never responds to an accepted pong", async () => {
    expect(
      await runEvent(
        request({ ...ping, type: "pong", data: { pingId: "first" } }),
      ),
    ).toEqual({ statusCode: 204 });
    expect(get).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
