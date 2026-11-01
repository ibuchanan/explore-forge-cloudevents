import { z } from "zod";

const envelope = z.strictObject({
  specversion: z.literal("1.0"),
  id: z.string().min(1),
  source: z
    .string()
    .min(1)
    .refine((value) => {
      try {
        new URL(value, "https://peer.invalid/");
        return true;
      } catch {
        return false;
      }
    }),
  traceparent: z.unknown().optional(),
});

export const pingEvent = envelope.extend({
  type: z.literal("ping"),
  data: z.strictObject({}),
});

export const pongEvent = envelope.extend({
  type: z.literal("pong"),
  data: z.strictObject({ pingId: z.string().min(1) }),
});

export const peerEvent = z.discriminatedUnion("type", [pingEvent, pongEvent]);
