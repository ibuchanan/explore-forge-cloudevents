import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateEventContracts } from "./generate-events";

describe("public event contracts", () => {
  it("keeps AsyncAPI and Modelina models aligned with Zod", async () => {
    const { asyncapi, models } = await generateEventContracts();
    expect(JSON.parse(readFileSync("specs/asyncapi.json", "utf8"))).toEqual(
      asyncapi,
    );
    expect(readFileSync("src/generated/events.ts", "utf8")).toBe(models);
    expect(asyncapi.asyncapi).toBe("3.0.0");
    expect(asyncapi.components.schemas.PingEvent).toMatchObject({
      properties: { traceparent: {} },
    });
    expect(asyncapi.components.schemas.PongEvent).toMatchObject({
      properties: { data: { required: ["pingId"] } },
    });
    expect(models).toContain("'type': 'ping'");
    expect(models).toContain("'type': 'pong'");
    expect(models).toContain("interface PingEvent");
    expect(models).toContain("interface PongEvent");
    expect(models).toContain("'traceparent'?");
  });
});
