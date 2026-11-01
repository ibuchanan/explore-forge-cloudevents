import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = readFileSync("manifest.yml", "utf8");
const contract = JSON.parse(readFileSync("openrpc.json", "utf8"));

describe("endpoint discovery contract", () => {
  it("routes a separate event receiver and protected RPC to exported handlers", () => {
    expect(manifest).toContain("key: peer-event\n      function: event");
    expect(manifest).toContain("key: config-rpc\n      function: rpc");
    expect(manifest).toContain("handler: index.runRpc");
    expect(manifest).toContain("handler: index.adminResolver");
    expect(manifest).toContain("- read:jira-work");
  });
  it("describes the implemented by-name endpoint.get result", () => {
    expect(contract.methods).toHaveLength(4);
    expect(contract.methods[0].name).toBe("endpoint.get");
    expect(contract.methods[0].params).toEqual([]);
    expect(contract.methods[0].paramStructure).toBe("by-name");
    expect(contract.methods[0].result.schema.required).toEqual(["eventUrl"]);
    expect(contract.methods[0].result.schema.additionalProperties).toBe(false);
  });
  it("documents connection methods, parameter and result shapes, and storage errors", () => {
    expect(manifest).toContain("- storage:app");
    expect(
      contract.methods.slice(1).map((method: { name: string }) => method.name),
    ).toEqual(["connections.list", "connections.create", "connections.delete"]);
    for (const method of contract.methods.slice(1)) {
      expect(method.paramStructure).toBe("by-name");
      expect(method.errors).toContainEqual({
        code: -32002,
        message: "Configuration unavailable",
      });
    }
    expect(contract.methods[1].params).toEqual([]);
    expect(
      contract.methods[2].params.map((param: { name: string }) => param.name),
    ).toEqual(["name", "eventUrl"]);
    expect(
      contract.methods[3].params.map((param: { name: string }) => param.name),
    ).toEqual(["connectionId"]);
    expect(contract.methods[1].result.schema.required).toEqual(["connections"]);
    expect(contract.methods[2].result.schema.required).toEqual(["connection"]);
    expect(contract.methods[3].result.schema.required).toEqual(["deleted"]);
  });
});
