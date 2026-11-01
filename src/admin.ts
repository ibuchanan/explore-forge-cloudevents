import { CommandError } from "./commands";

export function createAdminHandler(
  dispatch: (method: string, params: unknown) => Promise<unknown>,
  hasAdminPermission: () => Promise<boolean>,
  method = "endpoint.get",
) {
  return async (params: unknown): Promise<unknown> => {
    let allowed = false;
    try {
      allowed = await hasAdminPermission();
    } catch {
      // A failed permissions API call never grants access.
    }
    if (!allowed) throw new Error("Forbidden");
    try {
      return await dispatch(method, params);
    } catch (error) {
      if (error instanceof CommandError) throw error;
      throw new Error("Internal error");
    }
  };
}
