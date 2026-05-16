# Oculus SDK

This document describes the current public SDK surface for building realtime collaborative apps with Oculus.

## Packages

- `@oculus/sdk`: framework-neutral browser SDK.
- `@oculus/svelte`: Svelte store wrapper around `@oculus/sdk`.

## Install And Run

This repo uses Bun workspaces.

```bash
bun install
bun run server
bun run demo
```

The demo expects the server at `http://localhost:3000`.

## Core Client

```ts
import { createClient } from "@oculus/sdk";

const client = createClient({
  serverUrl: "http://localhost:3000",
  userId: "user_123",
  authToken: "optional-token"
});
```

### `createClient(options)`

Creates an `OculusClient`.

Options:

- `serverUrl`: HTTP base URL for the Oculus server. The SDK converts this to WebSocket URLs for room connections.
- `userId`: optional stable user id for presence and event attribution.
- `authToken`: optional token reserved for authenticated server flows.

## Rooms

```ts
const room = client.room<WorkflowState>("workflow_123");
await room.connect();
```

### `client.room<S>(roomId, options?)`

Creates an `OculusRoom<S>` for a shared room.

Options:

- `schema`: optional Zod schema. Mutations are validated against the next optimistic state before they are sent.

### `room.connect()`

Opens the WebSocket connection and resolves after the server sends `room_init`.

### `room.disconnect()`

Closes the WebSocket connection.

### `room.getState()`

Returns a cloned snapshot of the local room state.

### `room.getVersion()`

Returns the latest server version known by the client.

### `room.isConnected()`

Returns whether the WebSocket is currently connected.

## State Mutations

Use `stateApi.collection(name)` to mutate object collections.

```ts
await room.stateApi.collection("nodes").insert("node_1", {
  id: "node_1",
  x: 120,
  y: 160,
  label: "Start"
});

await room.stateApi.collection("nodes").update("node_1", {
  x: 220,
  y: 180
});

await room.stateApi.collection("nodes").delete("node_1");
```

### `insert(id, data)`

Creates an `insert` operation at `collection.id`.

### `update(id, data)`

Splits object updates into field-level operations such as `nodes.node_1.x` and `nodes.node_1.y`.

This is important because server conflict strategies operate at field level.

### `delete(id)`

Creates a `delete` operation for `collection.id`.

Mutation behavior:

- Mutations apply optimistically to local state immediately.
- Accepted mutations resolve after server ack.
- Rejected or timed-out mutations roll local state back.
- If disconnected, mutations are queued locally and flushed after reconnect.

## Presence

```ts
room.presence.update({
  cursor: { x: 200, y: 400 },
  selectedNodeId: "node_1",
  name: "Ada",
  color: "#2563eb"
});
```

### `presence.update(data, options?)`

Sends ephemeral presence data to other connected clients.

Options:

- `throttle`: minimum milliseconds between presence sends. Default is `40`.

### `presence.onChange(handler)`

Subscribes to presence broadcasts.

### `presence.lock(path)`

Writes the current user/client id to a path and returns a lock object.

```ts
const lock = await room.presence.lock("nodes.node_1.lockedBy");
await lock.release();
```

The current server has a simple custom resolver for `nodes.*.lockedBy`.

## Events And Replay

```ts
const events = await room.getEvents();
const stateAtVersion = await room.replayAt(2);
```

### `room.getEvents()`

Fetches the room event log from the server.

### `room.replayAt(version)`

Fetches reconstructed room state at a specific version.

## Event Subscription

```ts
const unsubscribe = room.on("state_change", (state) => {
  console.log(state);
});

unsubscribe();
```

Events:

- `state_change`: local state changed.
- `connection_change`: connection boolean changed.
- `users_change`: connected users changed.
- `presence_change`: another client sent presence.
- `remote_mutation`: another client mutation arrived.

## Svelte Store

```ts
import { createOculusRoomStore } from "@oculus/svelte";

const room = createOculusRoomStore<WorkflowState>(client, "workflow_123");
```

The Svelte store exposes:

- `state`: readable room state store.
- `version`: readable server version store.
- `connected`: readable connection state store.
- `users`: readable connected users store.
- `cursors`: readable cursor presence map.
- `events`: readable event log store.
- `ready`: readable boolean derived from connection state.
- `insert(collection, id, data)`: collection insert helper.
- `update(collection, id, data)`: collection field update helper.
- `remove(collection, id)`: collection delete helper.
- `updatePresence(data, options?)`: presence helper.
- `replayAt(version)`: replay helper.
- `refreshEvents()`: reload event history.
- `disconnect()`: close the room connection.

Example:

```svelte
<script lang="ts">
  import { createOculusRoomStore } from "@oculus/svelte";
  import { client } from "./collab";

  const room = createOculusRoomStore(client, "workflow_123");
  const { state, connected, cursors } = room;
</script>

{#if $connected}
  <pre>{JSON.stringify($state, null, 2)}</pre>
{/if}
```

## Public Types

### `Operation`

```ts
type Operation = {
  op: "insert" | "update" | "delete";
  path: string;
  value?: unknown;
};
```

Operations use dot paths like `nodes.node_1.x`.

### `RoomEvent`

Server event-log entry for a mutation.

### `PresenceUser`

Connected user record with `userId`, `clientId`, and latest presence data.

### `OculusClientOptions`

Options for `createClient`.

### `RoomOptions`

Options for `client.room`, currently including optional Zod schema validation.
