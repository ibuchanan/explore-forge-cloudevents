import api, {
  route,
  webTrigger,
  type WebTriggerRequest,
  type WebTriggerResponse,
} from "@forge/api";
import { makeResolver } from "@forge/resolver";
import { createAdminHandler } from "./admin";
import { createCommands, type Commands } from "./commands";
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
});

export const runRpc = createRpcHandler(
  dispatch,
  () => process.env["RPC_BEARER_SECRET"],
);

// Ticket 03 replaces this placeholder with the CloudEvents receiver. It does not share RPC authentication.
export const runEvent = async (
  _request: WebTriggerRequest,
): Promise<WebTriggerResponse> => ({ statusCode: 501 });
