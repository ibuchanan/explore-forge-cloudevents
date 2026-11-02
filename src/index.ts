import api, { route, webTrigger } from "@forge/api";
import { makeResolver } from "@forge/resolver";
import { createAdminHandler } from "./admin";
import { CommandError, type Commands, createCommands } from "./commands";
import { receiveEvent } from "./event-receiver";
import { createRpcHandler } from "./rpc";

const dispatch = createCommands(() => webTrigger.getUrl("peer-event"));

async function hasAdminPermission(): Promise<boolean> {
  const response = await api
    .asUser()
    .requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`);
  if (!response.ok) return false;
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("permissions" in body))
    return false;
  const permissions = body.permissions;
  if (
    typeof permissions !== "object" ||
    permissions === null ||
    !("ADMINISTER" in permissions)
  )
    return false;
  const admin = permissions.ADMINISTER;
  return (
    typeof admin === "object" &&
    admin !== null &&
    "havePermission" in admin &&
    admin.havePermission === true
  );
}

export const adminResolver = makeResolver<Commands>({
  "endpoint.get": ({ payload }) =>
    createAdminHandler(
      dispatch,
      hasAdminPermission,
      "endpoint.get",
    )(payload) as Promise<ReturnType<Commands["endpoint.get"]>>,
  "connections.list": ({ payload }) =>
    createAdminHandler(
      dispatch,
      hasAdminPermission,
      "connections.list",
    )(payload) as Promise<ReturnType<Commands["connections.list"]>>,
  "connections.create": ({ payload }) =>
    createAdminHandler(
      dispatch,
      hasAdminPermission,
      "connections.create",
    )(payload) as Promise<ReturnType<Commands["connections.create"]>>,
  "connections.delete": ({ payload }) =>
    createAdminHandler(
      dispatch,
      hasAdminPermission,
      "connections.delete",
    )(payload) as Promise<ReturnType<Commands["connections.delete"]>>,
  "ping.send": ({ payload }) =>
    createAdminHandler(
      dispatch,
      hasAdminPermission,
      "ping.send",
    )(payload) as Promise<ReturnType<Commands["ping.send"]>>,
});

export const runRpc = createRpcHandler(
  dispatch,
  () => process.env["RPC_BEARER_SECRET"],
);

export const automationResolver = makeResolver<{
  "connections.list": (params: Record<string, never>) => {
    connections: { id: string; name: string }[];
  };
}>({
  "connections.list": async ({ payload }) => {
    try {
      const { connections } = (await dispatch(
        "connections.list",
        payload,
      )) as ReturnType<Commands["connections.list"]>;
      return { connections: connections.map(({ id, name }) => ({ id, name })) };
    } catch (error) {
      if (error instanceof CommandError) throw error;
      throw new Error("Internal error");
    }
  },
});

export async function runAutomationPing(payload: unknown) {
  try {
    return (await dispatch("ping.send", payload)) as ReturnType<
      Commands["ping.send"]
    >;
  } catch (error) {
    return {
      errors: [
        {
          message:
            error instanceof CommandError ? error.message : "Internal error",
        },
      ],
    };
  }
}

export const runEvent = receiveEvent;
