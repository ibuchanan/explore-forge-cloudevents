import { writeFileSync } from "node:fs";
import { TypeScriptGenerator } from "@asyncapi/modelina";
import { z } from "zod";
import { pingEvent, pongEvent } from "./events";

export async function generateEventContracts() {
  const asyncapi = {
    asyncapi: "3.0.0",
    info: { title: "Peer ping and pong events", version: "0.1.0" },
    defaultContentType: "application/cloudevents+json",
    channels: {
      peerEvents: {
        address: "/",
        messages: {
          PingEvent: { $ref: "#/components/messages/PingEvent" },
          PongEvent: { $ref: "#/components/messages/PongEvent" },
        },
      },
    },
    operations: {
      receiveEvent: {
        action: "receive",
        channel: { $ref: "#/channels/peerEvents" },
        messages: [
          { $ref: "#/channels/peerEvents/messages/PingEvent" },
          { $ref: "#/channels/peerEvents/messages/PongEvent" },
        ],
      },
      sendEvent: {
        action: "send",
        channel: { $ref: "#/channels/peerEvents" },
        messages: [
          { $ref: "#/channels/peerEvents/messages/PingEvent" },
          { $ref: "#/channels/peerEvents/messages/PongEvent" },
        ],
      },
    },
    components: {
      messages: {
        PingEvent: {
          name: "PingEvent",
          payload: { $ref: "#/components/schemas/PingEvent" },
        },
        PongEvent: {
          name: "PongEvent",
          payload: { $ref: "#/components/schemas/PongEvent" },
        },
      },
      schemas: {
        PingEvent: z.toJSONSchema(pingEvent, { target: "draft-7" }),
        PongEvent: z.toJSONSchema(pongEvent, { target: "draft-7" }),
      },
    },
  };
  const generated = await new TypeScriptGenerator({
    modelType: "interface",
    rawPropertyNames: true,
  }).generate(asyncapi);
  const models = `// Generated from src/events.ts via src/generate-events.ts; do not edit.\n${generated.map((model) => `export ${model.result.trimEnd().replace(/[ \t]+$/gm, "")}`).join("\n\n")}\n`;
  return { asyncapi, models };
}

if (import.meta.main) {
  const { asyncapi, models } = await generateEventContracts();
  writeFileSync("asyncapi.json", `${JSON.stringify(asyncapi, null, 2)}\n`);
  writeFileSync("src/generated/events.ts", models);
}
