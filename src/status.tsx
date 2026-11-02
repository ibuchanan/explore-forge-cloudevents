import { makeInvoke, router } from "@forge/bridge";
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
type State =
  | "loading"
  | "error"
  | {
      eventUrl: string;
      count: number;
    };

export function Status({
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
  useEffect(() => {
    Promise.all([invoke("endpoint.get", {}), invoke("connections.list", {})])
      .then(([endpoint, list]) =>
        setState({
          eventUrl: endpoint.eventUrl,
          count: list.connections.length,
        }),
      )
      .catch(() => setState("error"));
  }, []);

  async function refresh() {
    if (state === "loading") return;
    const previous = state;
    setState("loading");
    try {
      const { connections } = await invoke("connections.list", {});
      if (typeof previous === "object")
        setState({ ...previous, count: connections.length });
      else {
        const { eventUrl } = await invoke("endpoint.get", {});
        setState({ eventUrl, count: connections.length });
      }
    } catch {
      setState("error");
    }
  }

  return (
    <Stack space="space.200">
      <Heading as="h1" size="large">
        Status
      </Heading>
      {state === "loading" && <Text>Loading configuration…</Text>}
      {state === "error" && (
        <SectionMessage appearance="error">
          Configuration unavailable. Try again later.
        </SectionMessage>
      )}
      {typeof state === "object" && (
        <>
          <Text>
            {state.count === 0
              ? "No connections configured"
              : `${state.count} connections configured`}
          </Text>
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
        </>
      )}
      <Button isDisabled={state === "loading"} onClick={refresh}>
        Refresh
      </Button>
      <Button
        onClick={() =>
          router.navigate({
            target: "module",
            moduleKey: "configure-connections",
          })
        }
      >
        Configure
      </Button>
      <Button
        onClick={() =>
          router.navigate({ target: "module", moduleKey: "get-started" })
        }
      >
        Get Started
      </Button>
      {feedback && <Text>{feedback}</Text>}
    </Stack>
  );
}

ForgeReconciler.render(<Status />);
