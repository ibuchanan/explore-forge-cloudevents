import { makeInvoke, view } from "@forge/bridge";
import ForgeReconciler, {
  Form,
  Label,
  Select,
  Text,
  useProductContext,
} from "@forge/react";
import { useEffect, useState } from "react";
type Choice = { id: string; name: string };
type ConfigCommands = {
  "connections.list": (params: Record<string, never>) => {
    connections: Choice[];
  };
};
const invoke = makeInvoke<ConfigCommands>();

type State = { connections: Choice[] } | "loading" | "error";

function App() {
  const context = useProductContext();
  const saved = context?.extension?.["data"]?.inputs?.connectionId;
  const [state, setState] = useState<State>("loading");
  const [choice, setChoice] = useState<string | null>(null);
  const connectionId = choice ?? (typeof saved === "string" ? saved : "");

  useEffect(() => {
    invoke("connections.list", {})
      .then(setState)
      .catch(() => setState("error"));
  }, []);

  if (state === "loading" || !context) return <Text>Loading connections…</Text>;
  if (state === "error")
    return (
      <Text>Connections unavailable. Reopen the action to try again.</Text>
    );
  if (state.connections.length === 0)
    return (
      <Text>
        No connections configured. Ask an app administrator to add one.
      </Text>
    );

  const options = state.connections.map(({ id, name }) => ({
    label: name,
    value: id,
  }));
  const selected = options.find(({ value }) => value === connectionId);

  return (
    <Form
      onSubmit={() => {
        if (selected) view.submit({ connectionId: selected.value });
      }}
    >
      <Label labelFor="connection">Connection</Label>
      <Select
        inputId="connection"
        options={options}
        value={selected ?? null}
        placeholder="Select a connection"
        isRequired
        isInvalid={!!connectionId && !selected}
        onChange={(option) => {
          const id = option?.value ?? "";
          setChoice(id);
          if (options.some(({ value }) => value === id))
            view.submit({ connectionId: id });
        }}
      />
      {!!connectionId && !selected && (
        <Text>
          Saved connection is no longer configured. Select another connection.
        </Text>
      )}
    </Form>
  );
}

ForgeReconciler.render(<App />);
