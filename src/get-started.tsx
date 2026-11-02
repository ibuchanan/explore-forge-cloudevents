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
type Configuration = { eventUrl: string; count: number };

export function GetStarted({
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
  const [configuration, setConfiguration] = useState<
    Configuration | "loading" | "error"
  >("loading");
  const [feedback, setFeedback] = useState("");
  useEffect(() => {
    Promise.all([invoke("endpoint.get", {}), invoke("connections.list", {})])
      .then(([endpoint, list]) =>
        setConfiguration({
          eventUrl: endpoint.eventUrl,
          count: list.connections.length,
        }),
      )
      .catch(() => setConfiguration("error"));
  }, []);

  return (
    <Stack space="space.200">
      <Heading as="h1" size="large">
        Get Started
      </Heading>
      <Text>Install the same app on both sites.</Text>
      <Text>
        Copy each installation's event URL and create reciprocal connections on
        the other site.
      </Text>
      <Text>
        Add the Send ping Automation Action on one site, select its peer
        connection, and run the rule to demo the exchange.
      </Text>
      <Text>
        Inspect structured logs on both sites and use trace correlation to
        follow the exchange. This page does not verify the peer or a round trip.
      </Text>
      {configuration === "loading" && <Text>Loading configuration…</Text>}
      {configuration === "error" && (
        <SectionMessage appearance="error">
          Configuration unavailable. Try again later.
        </SectionMessage>
      )}
      {typeof configuration === "object" && (
        <>
          <Text>
            {configuration.count === 0
              ? "No connections configured"
              : `${configuration.count} connections configured`}
          </Text>
          <Label labelFor="local-url">Local event URL</Label>
          <Inline space="space.100">
            <Textfield
              id="local-url"
              value={configuration.eventUrl}
              isReadOnly
            />
            <Button
              onClick={() =>
                copy(configuration.eventUrl)
                  .then(() => setFeedback("URL copied"))
                  .catch(() =>
                    setFeedback(
                      "Unable to copy URL. Select the URL to copy it.",
                    ),
                  )
              }
            >
              Copy
            </Button>
          </Inline>
        </>
      )}
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
          router.navigate({ target: "module", moduleKey: "status" })
        }
      >
        Status
      </Button>
      {feedback && <Text>{feedback}</Text>}
    </Stack>
  );
}

ForgeReconciler.render(<GetStarted />);
