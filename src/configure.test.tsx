import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, copy } = vi.hoisted(() => ({ invoke: vi.fn(), copy: vi.fn() }));
vi.mock("@forge/bridge", () => ({ makeInvoke: () => invoke }));
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
import { Configure } from "./configure";

async function render() {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Configure copy={copy} />);
  });
  return tree;
}
const text = (tree: ReactTestRenderer) => JSON.stringify(tree.toJSON());
const element = (tree: ReactTestRenderer, type: string, label: string) =>
  tree.root
    .findAll((item) => String(item.type) === type)
    .find(
      (item) => item.props["children"] === label || item.props["id"] === label,
    );
const button = (tree: ReactTestRenderer, label: string) =>
  element(tree, "Button", label);
const field = (tree: ReactTestRenderer, id: string) =>
  element(tree, "Textfield", id);

const local = "https://local.example/opaque";
const peer = {
  id: "peer-1",
  name: "Peer",
  eventUrl: "https://peer.example/event",
};
function ready(connections = [peer]) {
  invoke.mockImplementation((method: string) =>
    method === "endpoint.get"
      ? Promise.resolve({ eventUrl: local })
      : Promise.resolve({ connections }),
  );
}

describe("Configure page", () => {
  beforeEach(() => {
    invoke.mockReset();
    copy.mockReset().mockResolvedValue(undefined);
  });

  it("shows progress, then the local URL and empty configuration without contacting a peer", async () => {
    let finish!: (value: { connections: [] }) => void;
    invoke.mockImplementation((method: string) =>
      method === "endpoint.get"
        ? Promise.resolve({ eventUrl: local })
        : new Promise((resolve) => {
            finish = resolve;
          }),
    );
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<Configure copy={copy} />);
    });
    expect(text(tree)).toContain("Loading configuration");
    expect(text(tree)).not.toContain("No connections configured");
    await act(async () => finish({ connections: [] }));
    expect(text(tree)).toContain("No connections configured");
    expect(field(tree, "local-url")?.props["value"]).toBe(local);
    await act(async () => button(tree, "Copy")?.props["onClick"]());
    expect(copy).toHaveBeenCalledWith(local);
    expect(invoke.mock.calls.map(([method]) => method)).toEqual([
      "endpoint.get",
      "connections.list",
    ]);
  });

  it("keeps read failures distinct from empty configuration", async () => {
    invoke.mockImplementation((method: string) =>
      method === "endpoint.get"
        ? Promise.resolve({ eventUrl: local })
        : Promise.reject(new Error("secret https://peer.example/event")),
    );
    const tree = await render();
    expect(text(tree)).toContain("Configuration unavailable");
    expect(text(tree)).not.toContain("No connections configured");
    expect(text(tree)).not.toContain("peer.example");
  });

  it("sends ping only on explicit row action, showing acknowledgement without a round-trip claim", async () => {
    ready();
    const tree = await render();
    expect(text(tree)).toContain(peer.name);
    expect(invoke.mock.calls.map(([method]) => method)).toEqual([
      "endpoint.get",
      "connections.list",
    ]);
    await act(async () => button(tree, "Send ping")?.props["onClick"]());
    expect(invoke).toHaveBeenCalledWith("ping.send", { connectionId: peer.id });
    expect(text(tree)).toContain("Ping delivery acknowledged");
    expect(text(tree)).not.toContain("Round trip successful");
  });

  it("prevents overlapping commands while ping is pending and never retries a failed send", async () => {
    let reject!: (reason: Error) => void;
    ready();
    invoke.mockImplementation((method: string) =>
      method === "endpoint.get"
        ? Promise.resolve({ eventUrl: local })
        : method === "connections.list"
          ? Promise.resolve({ connections: [peer] })
          : new Promise((_resolve, fail) => {
              reject = fail;
            }),
    );
    const tree = await render();
    await act(async () => {
      button(tree, "Send ping")?.props["onClick"]();
    });
    expect(button(tree, "Delete")?.props["isDisabled"]).toBe(true);
    await act(async () => {
      button(tree, "Delete")?.props["onClick"]();
    });
    expect(
      invoke.mock.calls.filter(([method]) => method === "ping.send"),
    ).toHaveLength(1);
    expect(
      invoke.mock.calls.filter(([method]) => method === "connections.delete"),
    ).toHaveLength(0);
    await act(async () => reject(new Error(`timeout ${peer.eventUrl}`)));
    expect(text(tree)).toContain(
      "It may have arrived; do not retry automatically",
    );
    expect(text(tree)).not.toContain("timeout");
    expect(
      invoke.mock.calls.filter(([method]) => method === "ping.send"),
    ).toHaveLength(1);
  });

  it("warns before deleting and does not delete until confirmed", async () => {
    ready();
    const tree = await render();
    await act(async () => button(tree, "Delete")?.props["onClick"]());
    expect(text(tree)).toContain(
      "Saved Actions using this connection ID will fail",
    );
    expect(invoke).not.toHaveBeenCalledWith(
      "connections.delete",
      expect.anything(),
    );
    await act(async () => button(tree, "Confirm delete")?.props["onClick"]());
    expect(invoke).toHaveBeenCalledWith("connections.delete", {
      connectionId: peer.id,
    });
    expect(text(tree)).toContain("No connections configured");
    expect(invoke).not.toHaveBeenCalledWith("ping.send", expect.anything());
  });

  it("shows a new connection only after create acknowledgement and clears the form", async () => {
    let finish!: (value: { connection: typeof peer }) => void;
    invoke.mockImplementation((method: string) =>
      method === "endpoint.get"
        ? Promise.resolve({ eventUrl: local })
        : method === "connections.list"
          ? Promise.resolve({ connections: [] })
          : new Promise((resolve) => {
              finish = resolve;
            }),
    );
    const tree = await render();
    await act(async () => {
      field(tree, "name")?.props["onChange"]({ target: { value: peer.name } });
      field(tree, "event-url")?.props["onChange"]({
        target: { value: peer.eventUrl },
      });
    });
    await act(async () => {
      button(tree, "Create connection")?.props["onClick"]();
    });
    expect(text(tree)).toContain("No connections configured");
    expect(button(tree, "Create connection")?.props["isDisabled"]).toBe(true);
    await act(async () => finish({ connection: peer }));
    expect(text(tree)).not.toContain("No connections configured");
    expect(field(tree, "name")?.props["value"]).toBe("");
    expect(field(tree, "event-url")?.props["value"]).toBe("");
    expect(invoke).not.toHaveBeenCalledWith("ping.send", expect.anything());
  });

  it("reloads after uncertain create before allowing resubmission", async () => {
    let creates = 0;
    invoke.mockImplementation((method: string) =>
      method === "endpoint.get"
        ? Promise.resolve({ eventUrl: local })
        : method === "connections.list"
          ? Promise.resolve({ connections: creates ? [peer] : [] })
          : method === "connections.create" && ++creates === 1
            ? Promise.reject(new Error("lost response"))
            : Promise.resolve({ connection: peer }),
    );
    const tree = await render();
    await act(async () => {
      field(tree, "name")?.props["onChange"]({ target: { value: peer.name } });
      field(tree, "event-url")?.props["onChange"]({
        target: { value: peer.eventUrl },
      });
    });
    await act(async () =>
      button(tree, "Create connection")?.props["onClick"](),
    );
    expect(button(tree, "Create connection")?.props["isDisabled"]).toBe(true);
    await act(async () =>
      button(tree, "Create connection")?.props["onClick"](),
    );
    expect(creates).toBe(1);
    await act(async () =>
      button(tree, "Reload configuration")?.props["onClick"](),
    );
    expect(text(tree)).toContain(peer.name);
    expect(field(tree, "name")?.props["value"]).toBe(peer.name);
  });

  it("allows correction after a definite validation rejection without requiring reload", async () => {
    invoke.mockImplementation((method: string) =>
      method === "endpoint.get"
        ? Promise.resolve({ eventUrl: local })
        : method === "connections.list"
          ? Promise.resolve({ connections: [] })
          : Promise.reject(new Error("Invalid params")),
    );
    const tree = await render();
    await act(async () => {
      field(tree, "name")?.props["onChange"]({ target: { value: peer.name } });
      field(tree, "event-url")?.props["onChange"]({
        target: { value: peer.eventUrl },
      });
    });
    await act(async () =>
      button(tree, "Create connection")?.props["onClick"](),
    );
    expect(text(tree)).toContain("Invalid connection");
    expect(button(tree, "Create connection")?.props["isDisabled"]).toBe(false);
    expect(field(tree, "event-url")?.props["value"]).toBe(peer.eventUrl);
  });

  it("creates with entered values only on explicit submission and preserves them on failure", async () => {
    ready([]);
    invoke.mockImplementation((method: string) =>
      method === "endpoint.get"
        ? Promise.resolve({ eventUrl: local })
        : method === "connections.list"
          ? Promise.resolve({ connections: [] })
          : Promise.reject(new Error("secret https://peer.example/event")),
    );
    const tree = await render();
    await act(async () => {
      field(tree, "name")?.props["onChange"]({ target: { value: "Peer" } });
      field(tree, "event-url")?.props["onChange"]({
        target: { value: peer.eventUrl },
      });
    });
    await act(async () =>
      button(tree, "Create connection")?.props["onClick"](),
    );
    expect(invoke).toHaveBeenCalledWith("connections.create", {
      name: "Peer",
      eventUrl: peer.eventUrl,
    });
    expect(field(tree, "name")?.props["value"]).toBe("Peer");
    expect(text(tree)).toContain("Reload configuration before trying again");
    expect(text(tree)).not.toContain("secret");
  });
});
