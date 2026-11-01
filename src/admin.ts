import { CommandError, type Commands } from "./commands";

export function createAdminHandler(
  dispatch: (
    method: string,
    params: unknown,
  ) => Promise<ReturnType<Commands["endpoint.get"]>>,
  hasAdminPermission: () => Promise<boolean>,
) {
  return async (
    params: Record<string, never>,
  ): Promise<ReturnType<Commands["endpoint.get"]>> => {
    let allowed = false;
    try {
      allowed = await hasAdminPermission();
    } catch {
      // A failed permissions API call never grants access.
    }
    if (!allowed) throw new Error("Forbidden");
    try {
      return await dispatch("endpoint.get", params);
    } catch (error) {
      if (error instanceof CommandError) throw error;
      throw new Error("Internal error");
    }
  };
}
