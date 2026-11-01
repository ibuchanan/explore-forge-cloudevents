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
    expect(contract.methods).toHaveLength(1);
    expect(contract.methods[0].name).toBe("endpoint.get");
    expect(contract.methods[0].params).toEqual([]);
    expect(contract.methods[0].paramStructure).toBe("by-name");
    expect(contract.methods[0].result.schema.required).toEqual(["eventUrl"]);
    expect(contract.methods[0].result.schema.additionalProperties).toBe(false);
  });
});
