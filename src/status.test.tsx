import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, navigate, copy } = vi.hoisted(() => ({
  invoke: vi.fn(),
  navigate: vi.fn(),
  copy: vi.fn(),
}));
vi.mock("@forge/bridge", () => ({
  makeInvoke: () => invoke,
  router: { navigate },
}));
vi.mock("@forge/react", () => ({
  default: { render: vi.fn() },
  Button: "Button",
  Heading: "Heading",
  Inline: "Inline",
  Label: "Label",
  SectionMessage: "SectionMessage",
  Stack: "Stack",
  Text: "Text",
  Textfield: "Textfield",
}));
import { Status } from "./status";

const local = "https://local.example/opaque";
const methods = () => invoke.mock.calls.map(([method]) => method);
const text = (tree: ReactTestRenderer) => JSON.stringify(tree.toJSON());
const button = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    (item) =>
      String(item.type) === "Button" && item.props["children"] === label,
  )[0];
async function render() {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Status copy={copy} />);
  });
  return tree;
}

describe("Status page", () => {
  beforeEach(() => {
    invoke.mockReset();
    navigate.mockReset();
    copy.mockReset().mockResolvedValue(undefined);
  });

  it("shows loading instead of empty until authorized reads complete, then local configuration and Copy", async () => {
    let finish!: (value: { connections: [] }) => void;
    invoke.mockImplementation((method: string) =>
      method === "endpoint.get"
        ? Promise.resolve({ eventUrl: local })
        : new Promise((resolve) => {
            finish = resolve;
          }),
    );
    const tree = await render();
    expect(text(tree)).toContain("Loading configuration");
    expect(text(tree)).not.toContain("No connections configured");
    await act(async () => finish({ connections: [] }));
    expect(text(tree)).toContain("No connections configured");
    expect(tree.root.findByProps({ id: "local-url" }).props["value"]).toBe(
      local,
    );
    await act(async () => button(tree, "Copy")?.props["onClick"]());
    expect(copy).toHaveBeenCalledWith(local);
    expect(methods()).toEqual(["endpoint.get", "connections.list"]);
    expect(text(tree)).not.toMatch(/Send ping|healthy|round trip|history/i);
  });

  it("refreshes only configuration, shows the updated count, and navigates to the named pages", async () => {
    invoke.mockImplementation((method: string) =>
      method === "endpoint.get"
        ? Promise.resolve({ eventUrl: local })
        : Promise.resolve({
            connections: [
              { id: "p", name: "Peer", eventUrl: "https://peer.example/e" },
            ],
          }),
    );
    const tree = await render();
    expect(text(tree)).toContain("1 connections configured");
    invoke.mockImplementation((method: string) =>
      method === "connections.list"
        ? Promise.resolve({ connections: [] })
        : Promise.reject(new Error("Refresh must not reread endpoint")),
    );
    await act(async () => button(tree, "Refresh")?.props["onClick"]());
    expect(text(tree)).toContain("No connections configured");
    expect(methods()).toEqual([
      "endpoint.get",
      "connections.list",
      "connections.list",
    ]);
    await act(async () => button(tree, "Configure")?.props["onClick"]());
    await act(async () => button(tree, "Get Started")?.props["onClick"]());
    expect(navigate.mock.calls).toEqual([
      [{ target: "module", moduleKey: "configure-connections" }],
      [{ target: "module", moduleKey: "get-started" }],
    ]);
  });

  it("sanitizes read errors and retries configuration without a peer call", async () => {
    invoke.mockRejectedValue(new Error("sensitive backend details"));
    const tree = await render();
    expect(text(tree)).toContain("Configuration unavailable");
    expect(text(tree)).not.toContain("sensitive backend details");
    expect(text(tree)).not.toContain("No connections configured");
    invoke.mockImplementation((method: string) =>
      method === "endpoint.get"
        ? Promise.resolve({ eventUrl: local })
        : Promise.resolve({ connections: [] }),
    );
    await act(async () => button(tree, "Refresh")?.props["onClick"]());
    expect(text(tree)).toContain("No connections configured");
    expect(methods()).toEqual([
      "endpoint.get",
      "connections.list",
      "connections.list",
      "endpoint.get",
    ]);
  });
});
