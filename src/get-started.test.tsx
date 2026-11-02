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
import { GetStarted } from "./get-started";

const local = "https://local.example/opaque";
const text = (tree: ReactTestRenderer) => JSON.stringify(tree.toJSON());
const button = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    (item) =>
      String(item.type) === "Button" && item.props["children"] === label,
  )[0];
async function render() {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<GetStarted copy={copy} />);
  });
  return tree;
}

describe("Get Started page", () => {
  beforeEach(() => {
    invoke.mockReset();
    navigate.mockReset();
    copy.mockReset().mockResolvedValue(undefined);
  });

  it("keeps the two-site guide visible during loading and shows local setup after read", async () => {
    let finish!: (value: { connections: [] }) => void;
    invoke.mockImplementation((method: string) =>
      method === "endpoint.get"
        ? Promise.resolve({ eventUrl: local })
        : new Promise((resolve) => {
            finish = resolve;
          }),
    );
    const tree = await render();
    for (const phrase of [
      "Install the same app on both sites",
      "Copy each installation's event URL",
      "reciprocal connections",
      "Automation Action",
      "structured logs",
      "trace correlation",
    ])
      expect(text(tree)).toContain(phrase);
    expect(text(tree)).toContain("Loading configuration");
    expect(text(tree)).not.toContain("No connections configured");
    await act(async () => finish({ connections: [] }));
    expect(text(tree)).toContain("No connections configured");
    expect(tree.root.findByProps({ id: "local-url" }).props["value"]).toBe(
      local,
    );
    await act(async () => button(tree, "Copy")?.props["onClick"]());
    expect(copy).toHaveBeenCalledWith(local);
    expect(invoke.mock.calls.map(([method]) => method)).toEqual([
      "endpoint.get",
      "connections.list",
    ]);
    expect(button(tree, "Send ping")).toBeUndefined();
    expect(text(tree)).not.toMatch(/healthy|round trip successful|history/i);
  });

  it("keeps instructions and navigation available when protected reads fail", async () => {
    invoke.mockRejectedValue(new Error("sensitive backend details"));
    const tree = await render();
    expect(text(tree)).toContain("Configuration unavailable");
    expect(text(tree)).toContain("Install the same app on both sites");
    expect(text(tree)).not.toContain("sensitive backend details");
    expect(text(tree)).not.toContain(local);
    await act(async () => button(tree, "Configure")?.props["onClick"]());
    await act(async () => button(tree, "Status")?.props["onClick"]());
    expect(navigate.mock.calls).toEqual([
      [{ target: "module", moduleKey: "configure-connections" }],
      [{ target: "module", moduleKey: "status" }],
    ]);
  });
});
