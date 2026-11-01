import { describe, expect, it, vi } from "vitest";
import { createCommands } from "./commands";

describe("endpoint.get command", () => {
  it("returns the SDK-derived event URL only for empty object parameters", async () => {
    const getEventUrl = vi
      .fn()
      .mockResolvedValue("https://example.test/events");
    const commands = createCommands(getEventUrl);
    expect(await commands("endpoint.get", {})).toEqual({
      eventUrl: "https://example.test/events",
    });
    expect(getEventUrl).toHaveBeenCalledOnce();
    await expect(
      commands("endpoint.get", { eventUrl: "https://attacker.test" }),
    ).rejects.toThrow("Invalid params");
    await expect(commands("unknown", {})).rejects.toThrow("Method not found");
    expect(getEventUrl).toHaveBeenCalledOnce();
  });
});
