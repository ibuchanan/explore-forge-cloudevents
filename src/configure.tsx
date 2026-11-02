import { makeInvoke } from "@forge/bridge";
import ForgeReconciler, {
  Button,
  Heading,
  Inline,
  Label,
  SectionMessage,
  Stack,
  Text,
  Textfield,
} from "@forge/react";
import { useEffect, useState } from "react";
import type { Commands } from "./commands";

const invoke = makeInvoke<Commands>();
type Data = {
  eventUrl: string;
  connections: ReturnType<Commands["connections.list"]>["connections"];
};

type State = "loading" | "error" | Data;

export function Configure({
  copy = (value) =>
    (
      globalThis as {
        navigator?: {
          clipboard?: { writeText: (text: string) => Promise<void> };
        };
      }
    ).navigator?.clipboard?.writeText(value) ?? Promise.reject(),
}: {
  copy?: (value: string) => Promise<void>;
}) {
  const [state, setState] = useState<State>("loading");
  const [feedback, setFeedback] = useState("");
  const [name, setName] = useState("");
  const [eventUrl, setEventUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function sendPing(connectionId: string) {
    if (busy || uncertain || typeof state !== "object") return;
    setBusy(true);
    setFeedback("");
    try {
      await invoke("ping.send", { connectionId });
      setFeedback(
        "Ping delivery acknowledged. Check logs separately for a pong.",
      );
    } catch {
      setFeedback(
        "Ping delivery not confirmed. It may have arrived; do not retry automatically.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteConnection(connectionId: string) {
    if (
      busy ||
      uncertain ||
      deleting !== connectionId ||
      typeof state !== "object"
    )
      return;
    setBusy(true);
    setFeedback("");
    try {
      await invoke("connections.delete", { connectionId });
      setState({
        ...state,
        connections: state.connections.filter(({ id }) => id !== connectionId),
      });
      setDeleting(null);
      setFeedback(
        "Connection deleted. Saved Actions using this ID must select another connection.",
      );
    } catch {
      setUncertain(true);
      setFeedback(
        "Deletion outcome unknown. Reload configuration before trying again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createConnection() {
    if (busy || uncertain || typeof state !== "object") return;
    setBusy(true);
    setFeedback("");
    try {
      const result = await invoke("connections.create", { name, eventUrl });
      setState({
        ...state,
        connections: [...state.connections, result.connection],
      });
      setName("");
      setEventUrl("");
      setFeedback(
        "Connection created. Select its new ID in saved Actions if replacing a connection.",
      );
    } catch (error) {
      if (error instanceof Error && error.message === "Invalid params") {
        setFeedback(
          "Invalid connection. Check the name and HTTPS event URL, including duplicates.",
        );
      } else {
        setUncertain(true);
        setFeedback(
          "Creation outcome unknown. Reload configuration before trying again.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    if (busy) return;
    setBusy(true);
    try {
      const [endpoint, list] = await Promise.all([
        invoke("endpoint.get", {}),
        invoke("connections.list", {}),
      ]);
      setState({ ...endpoint, ...list });
      setUncertain(false);
      setFeedback("");
    } catch {
      setState("error");
      setFeedback(
        "Configuration unavailable. The previous change may have succeeded.",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    Promise.all([invoke("endpoint.get", {}), invoke("connections.list", {})])
      .then(([endpoint, list]) => setState({ ...endpoint, ...list }))
      .catch(() => setState("error"));
  }, []);

  return (
    <Stack space="space.200">
      <Heading as="h1" size="large">
        Configure connections
      </Heading>
      {(state === "loading" || busy) && <Text>Loading configuration…</Text>}
      {state === "error" && (
        <SectionMessage appearance="error">
          Configuration unavailable. Reload configuration to try again.
        </SectionMessage>
      )}
      <Button isDisabled={busy || state === "loading"} onClick={reload}>
        Reload configuration
      </Button>
      {typeof state === "object" && (
        <>
          <Label labelFor="local-url">Local event URL</Label>
          <Inline space="space.100">
            <Textfield id="local-url" value={state.eventUrl} isReadOnly />
            <Button
              onClick={() => {
                copy(state.eventUrl)
                  .then(() => setFeedback("URL copied"))
                  .catch(() =>
                    setFeedback(
                      "Unable to copy URL. Select the URL to copy it.",
                    ),
                  );
              }}
            >
              Copy
            </Button>
          </Inline>
          <Heading as="h2" size="medium">
            Peer connections
          </Heading>
          {state.connections.length === 0 && (
            <Text>No connections configured</Text>
          )}
          {state.connections.map((connection) => (
            <Stack space="space.100" key={connection.id}>
              <Text>{connection.name}</Text>
              <Text>{connection.eventUrl}</Text>
              <Inline space="space.100">
                <Button
                  isDisabled={busy || uncertain}
                  onClick={() => sendPing(connection.id)}
                >
                  Send ping
                </Button>
                <Button
                  isDisabled={busy || uncertain}
                  onClick={() => setDeleting(connection.id)}
                >
                  Delete
                </Button>
              </Inline>
              {deleting === connection.id && (
                <SectionMessage appearance="warning">
                  <Text>
                    Saved Actions using this connection ID will fail. Deletion
                    cannot cancel an in-flight send.
                  </Text>
                  <Inline space="space.100">
                    <Button
                      appearance="danger"
                      isDisabled={busy || uncertain}
                      onClick={() => deleteConnection(connection.id)}
                    >
                      Confirm delete
                    </Button>
                    <Button isDisabled={busy} onClick={() => setDeleting(null)}>
                      Cancel
                    </Button>
                  </Inline>
                </SectionMessage>
              )}
            </Stack>
          ))}
          <Label labelFor="name">Name</Label>
          <Textfield
            id="name"
            value={name}
            isRequired
            isDisabled={busy || uncertain}
            onChange={(event) => setName(event.target.value)}
          />
          <Label labelFor="event-url">Event URL</Label>
          <Textfield
            id="event-url"
            value={eventUrl}
            isRequired
            isDisabled={busy || uncertain}
            onChange={(event) => setEventUrl(event.target.value)}
          />
          <Button
            appearance="primary"
            isDisabled={busy || uncertain || !name.trim() || !eventUrl}
            onClick={createConnection}
          >
            Create connection
          </Button>
        </>
      )}
      {feedback && <Text>{feedback}</Text>}
    </Stack>
  );
}

ForgeReconciler.render(<Configure />);
