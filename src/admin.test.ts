import { describe, expect, it, vi } from "vitest";
import { createAdminHandler } from "./admin";
import { createCommands } from "./commands";

describe("admin resolver", () => {
  const setup = (allowed: () => Promise<boolean>) => {
    const dispatch = vi
      .fn()
      .mockResolvedValue({ eventUrl: "https://example.test/events" });
    return { handle: createAdminHandler(dispatch, allowed), dispatch };
  };
  it("checks permission on every call and dispatches only when ADMINISTER is granted", async () => {
    const allowed = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const { handle, dispatch } = setup(allowed);
    await expect(handle({})).resolves.toEqual({
      eventUrl: "https://example.test/events",
    });
    await expect(handle({})).rejects.toThrow("Forbidden");
    expect(allowed).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith("endpoint.get", {});
  });
  it("denies failed permission checks without dispatching or leaking exceptions", async () => {
    const { handle, dispatch } = setup(() =>
      Promise.reject(new Error("secret permission failure")),
    );
    await expect(handle({})).rejects.toThrow("Forbidden");
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("rejects caller-supplied fields without discovering the URL", async () => {
    const getEventUrl = vi
      .fn()
      .mockResolvedValue("https://example.test/events");
    const handle = createAdminHandler(
      createCommands(getEventUrl),
      async () => true,
    );
    await expect(
      handle({ eventUrl: "https://attacker.test" } as unknown as Record<
        string,
        never
      >),
    ).rejects.toThrow("Invalid params");
    expect(getEventUrl).not.toHaveBeenCalled();
  });
});
