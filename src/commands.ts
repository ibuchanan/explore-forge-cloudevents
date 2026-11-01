export type Commands = {
  "endpoint.get": (params: Record<string, never>) => { eventUrl: string };
};

export class CommandError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export function createCommands(getEventUrl: () => Promise<string>) {
  return async (
    method: string,
    params: unknown,
  ): Promise<{ eventUrl: string }> => {
    if (method !== "endpoint.get")
      throw new CommandError(-32601, "Method not found");
    if (
      !params ||
      typeof params !== "object" ||
      Array.isArray(params) ||
      Object.keys(params).length !== 0
    ) {
      throw new CommandError(-32602, "Invalid params");
    }
    return { eventUrl: await getEventUrl() };
  };
}
