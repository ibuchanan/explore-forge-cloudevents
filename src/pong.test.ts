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

const records: Record<string, unknown>[] = [];
vi.mock("@forge-ahead/logging", async (importOriginal) => {
  const actual =
    (await importOriginal()) as typeof import("@forge-ahead/logging");
  return {
    ...actual,
    log: {
      info: (fields: Record<string, unknown>, message: string) =>
        records.push({ ...actual.getLogContext(), ...fields, message }),
    },
    createTraceContext: vi.fn(actual.createTraceContext),
    formatTraceparent: vi.fn(actual.formatTraceparent),
  };
});

import { createTraceContext, formatTraceparent } from "@forge-ahead/logging";
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
    records.length = 0;
    vi.mocked(createTraceContext).mockClear();
    vi.mocked(formatTraceparent).mockClear();
    get
      .mockReset()
      .mockResolvedValue({ connections: [connection("reverse", peer)] });
    fetch.mockReset().mockResolvedValue({ status: 204 });
    getUrl.mockReset().mockResolvedValue(local);
  });

  it("continues an incoming sampled trace in ping and outgoing pong records", async () => {
    const parent = "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01";
    expect(await runEvent(request({ ...ping, traceparent: parent }))).toEqual({
      statusCode: 204,
    });
    const pong = JSON.parse(fetch.mock.calls[0]?.[1].body);
    const [, traceId, spanId, flags] = pong.traceparent.split("-");
    expect(traceId).toBe("0123456789abcdef0123456789abcdef");
    expect(spanId).not.toBe("0123456789abcdef");
    expect(flags).toBe("01");
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "ping received",
          eventId: ping.id,
          traceId,
          spanId,
          parentSpanId: "0123456789abcdef",
          traceFlags: 1,
        }),
        expect.objectContaining({
          message: "pong sent",
          eventId: pong.id,
          pingId: ping.id,
          connectionId: "reverse",
          traceId,
          spanId,
          traceFlags: 1,
        }),
      ]),
    );
    expect(JSON.stringify(records)).not.toContain(peer);
  });

  it("restarts invalid or missing incoming traces without echoing untrusted values", async () => {
    for (const traceparent of [undefined, `secret-${peer}`]) {
      records.length = 0;
      fetch.mockClear();
      expect(await runEvent(request({ ...ping, traceparent }))).toEqual({
        statusCode: 204,
      });
      const pong = JSON.parse(fetch.mock.calls[0]?.[1].body);
      expect(pong.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-00$/);
      expect(records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: "peer trace restarted",
            eventId: ping.id,
            traceId: pong.traceparent.split("-")[1],
          }),
        ]),
      );
      expect(JSON.stringify(records)).not.toContain(peer);
    }
  });

  it("acknowledges terminal pong with a child trace and no outbound delivery", async () => {
    const traceparent =
      "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01";
    expect(
      await runEvent(
        request({
          ...ping,
          type: "pong",
          data: { pingId: "original" },
          traceparent,
        }),
      ),
    ).toEqual({ statusCode: 204 });
    expect(fetch).not.toHaveBeenCalled();
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "pong received",
          eventId: ping.id,
          pingId: "original",
          traceId: "0123456789abcdef0123456789abcdef",
          parentSpanId: "0123456789abcdef",
          traceFlags: 1,
        }),
      ]),
    );
  });

  it("does not echo URL-bearing event identifiers or ping identifiers in logs", async () => {
    const unsafeId = `id-${peer}-Bearer secret`;
    expect(
      await runEvent(
        request({ ...ping, id: unsafeId, traceparent: "invalid" }),
      ),
    ).toEqual({ statusCode: 204 });
    expect(JSON.stringify(records)).not.toContain(peer);
    expect(JSON.stringify(records)).not.toContain("Bearer secret");
    records.length = 0;
    expect(
      await runEvent(
        request({
          ...ping,
          type: "pong",
          id: "pong-1",
          data: { pingId: unsafeId },
        }),
      ),
    ).toEqual({ statusCode: 204 });
    expect(JSON.stringify(records)).not.toContain(peer);
    expect(JSON.stringify(records)).not.toContain("Bearer secret");
  });

  it("acknowledges local trace-helper failure without trace-less pong", async () => {
    vi.mocked(createTraceContext).mockReturnValueOnce({
      isErr: () => true,
    } as never);
    expect(await runEvent(request(ping))).toEqual({ statusCode: 204 });
    expect(fetch).not.toHaveBeenCalled();
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "trace-unavailable",
          eventId: ping.id,
        }),
      ]),
    );
  });

  it("acknowledges local formatting failure without trace-less pong", async () => {
    vi.mocked(formatTraceparent).mockReturnValueOnce({
      isErr: () => true,
    } as never);
    expect(await runEvent(request(ping))).toEqual({ statusCode: 204 });
    expect(fetch).not.toHaveBeenCalled();
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "trace-unavailable",
          eventId: ping.id,
        }),
      ]),
    );
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
    expect(await runEvent(request(ping))).toEqual({ statusCode: 204 });
    expect(fetch).not.toHaveBeenCalled();
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "peer pong skipped",
          reason: "no-reverse-connection",
          eventId: ping.id,
        }),
      ]),
    );
    expect(JSON.stringify(records)).not.toContain(peer);
  });

  it("does not guess between duplicate reverse connections", async () => {
    get.mockResolvedValue({
      connections: [connection("a", peer), connection("b", peer)],
    });
    expect(await runEvent(request(ping))).toEqual({ statusCode: 204 });
    expect(fetch).not.toHaveBeenCalled();
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "peer pong skipped",
          reason: "ambiguous",
          eventId: ping.id,
        }),
      ]),
    );
  });

  it("acknowledges ping despite one failed delivery without exposing peer details", async () => {
    fetch.mockRejectedValue(new Error(`private: ${peer} Bearer secret`));
    expect(await runEvent(request(ping))).toEqual({ statusCode: 204 });
    expect(fetch).toHaveBeenCalledOnce();
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "peer pong skipped",
          reason: "delivery-unavailable",
          pingId: ping.id,
          connectionId: "reverse",
        }),
      ]),
    );
    expect(JSON.stringify(records)).not.toContain(peer);
    expect(JSON.stringify(records)).not.toContain("secret");
  });

  it("acknowledges a valid ping when configuration cannot be read", async () => {
    get.mockRejectedValue(new Error(`private: ${peer}`));
    expect(await runEvent(request(ping))).toEqual({ statusCode: 204 });
    expect(fetch).not.toHaveBeenCalled();
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "peer pong skipped",
          reason: "delivery-unavailable",
          eventId: ping.id,
        }),
      ]),
    );
    expect(JSON.stringify(records)).not.toContain(peer);
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
