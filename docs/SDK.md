# Oculus SDK

Oculus is a framework-neutral SDK for building self-hosted realtime collaboration. The default API is designed to read like app code: create items, change fields, edit text, move lists, update presence, and replay history. The lower-level operation API remains available when you are building adapters, custom widgets, or native CRDT integrations.

## Packages

- `@oculus/sdk`: browser SDK for any frontend.
- `@oculus/svelte`: Svelte store wrapper around `@oculus/sdk`.

## Install And Run

This repo uses Bun workspaces.

```bash
bun install
bun run server
bun run demo
```

The demo expects the server at `http://localhost:3000`.

## Intuitive Example

This is the recommended starting shape for app developers. Notice that the SDK does not require you to build dot paths by hand for normal collection and text work.

```ts
import { createClient } from "@oculus/sdk";

type WorkflowNode = {
  id: string;
  x: number;
  y: number;
  label: string;
  lockedBy?: string | null;
};

type WorkflowState = {
  nodes: Record<string, WorkflowNode>;
  layers: string[];
};

const client = createClient({
  serverUrl: "http://localhost:3000",
  userId: "ada"
});

const room = client.room<WorkflowState>("workflow_123");
await room.connect();

const nodes = room.collection<WorkflowNode>("nodes");

await nodes.create("node_1", {
  id: "node_1",
  x: 120,
  y: 160,
  label: "Start",
  lockedBy: null
});

await nodes.change("node_1", { x: 220, y: 180 });
await nodes.text("node_1", "label").insert(5, " here");

const lock = await nodes.lock("node_1", "lockedBy");
await room.presence.update({ cursor: { x: 220, y: 180 }, selectedId: "node_1" });

await room.list("layers").move(2, 0);
await nodes.remove("node_1", { preserveHistory: true });
await lock.release();
```

## Mental Model

- A client creates rooms.
- A room holds shared JSON-like state, presence, event history, and replay helpers.
- A collection manages records such as `nodes`, `documents`, `comments`, `cards`, or `shapes`.
- Text helpers edit string fields without forcing app code to know about CRDT internals.
- List and tree helpers cover ordered UI state such as layers, kanban columns, outlines, and design-tool hierarchies.
- `room.apply(...)` is the advanced escape hatch for raw operations and native Yjs updates.

Mutations apply optimistically to local state immediately. If the server accepts the mutation, the promise resolves after ack. If the server rejects or the mutation times out, the SDK rolls back to the previous local state. If the room is offline, mutations are queued locally and flushed after reconnect.

## Core Client

```ts
const client = createClient({
  serverUrl: "http://localhost:3000",
  userId: "user_123",
  authToken: "optional-token"
});
```

### `createClient(options)`

Creates an `OculusClient`.

Options:

- `serverUrl`: HTTP base URL for the Oculus server. The SDK converts it to WebSocket URLs for room connections.
- `userId`: optional stable user id for presence, locks, tombstones, and event attribution.
- `authToken`: optional token reserved for self-hosted authenticated server flows.

### `client.room<S>(roomId, options?)`

Creates an `OculusRoom<S>` for a shared room.

```ts
const room = client.room<WorkflowState>("workflow_123");
```

Options:

- `schema`: optional Zod schema. Mutations are validated against the next optimistic state before they are sent.

## Rooms

### `room.connect()`

Opens the WebSocket connection and resolves after the server sends `room_init`.

### `room.disconnect()`

Closes the WebSocket connection.

### `room.getState()`

Returns a cloned snapshot of local room state.

### `room.getVersion()`

Returns the latest server version known by the client.

### `room.isConnected()`

Returns whether the WebSocket is connected.

### `room.on(event, handler)`

Subscribes to room events and returns an unsubscribe function.

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

## Collections

Use collections for app records: nodes, documents, comments, cards, shapes, users, pages, layers metadata, and similar domain objects.

```ts
const nodes = room.collection<WorkflowNode>("nodes");
```

`room.stateApi.collection(name).insert/update/delete` is still available for older code, but new app code should prefer `room.collection(name).create/change/remove` because it is clearer and leaves room for typed helpers.

### `room.collection<T>(name)`

Creates an `OculusCollection<T>` helper for `state[name]`.

### `room.items<T>(name)`

Alias for `room.collection<T>(name)`. Use whichever reads better in your app.

### `collection.create(id, data)`

Creates or replaces the record at `collectionName.id`.

```ts
await nodes.create("node_1", { id: "node_1", x: 120, y: 160, label: "Start" });
```

### `collection.change(id, patch)`

Updates individual fields on a record.

```ts
await nodes.change("node_1", { x: 220, y: 180 });
```

Internally, this creates field-level operations such as `nodes.node_1.x` and `nodes.node_1.y`. Field-level operations give the server more room to merge independent changes.

### `collection.remove(id, options?)`

Deletes a record.

```ts
await nodes.remove("node_1");
await nodes.remove("node_2", { preserveHistory: true });
```

Options:

- `preserveHistory`: when true, writes a tombstone instead of removing the record. This is useful for offline clients because stale child-field updates cannot resurrect the deleted object.
- `deletedBy`: optional override for tombstone attribution. Defaults to `userId` or the generated client id.
- `deletedAt`: optional timestamp override. Defaults to the current time.

### `collection.text(id, field)`

Creates a text-field helper for a string field on a record.

```ts
await nodes.text("node_1", "label").insert(5, " here");
await nodes.text("node_1", "label").delete(0, 3);
await nodes.text("node_1", "label").replace("New label");
```

The `field` argument is type-aware: with `collection<WorkflowNode>`, string fields such as `label` are accepted, while numeric fields such as `x` are rejected by TypeScript.

### `text.insert(index, text)`

Applies a collaborative text insert.

### `text.delete(index, count)`

Applies a collaborative text deletion.

### `text.replace(text)`

Sets the materialized field value. Prefer `insert` and `delete` for character-level collaboration; use `replace` for rename flows, generated text, or simple form commits.

### `text.applyYjsUpdate(update)`

Advanced helper for native Yjs text updates. Accepts a `Uint8Array` or number array.

```ts
await nodes.text("node_1", "label").applyYjsUpdate(update);
```

### `collection.lock(id, field)`

Locks a field by writing the current user/client id to that field. Returns a lock object with `release()`.

```ts
const lock = await nodes.lock("node_1", "lockedBy");
await lock.release();
```

The current server includes a simple resolver for `nodes.*.lockedBy`.

## Ordered Lists

Use lists for visual ordering: layers, cards, blocks, tabs, ordered children, and similar arrays.

```ts
await room.list("layers").move(3, 1);
```

### `room.list(path)`

Creates an `OculusList` helper for an array path.

### `list.move(from, to)`

Moves one item from an array index to another index.

## Trees

Use trees for Figma-like hierarchy state, outlines, nested documents, file browsers, and grouped design nodes. A tree is represented as records whose values contain a `children` string array.

```ts
await room.tree("tree").move("node_1", {
  from: "root",
  to: "group_1",
  at: 0
});
```

### `room.tree(path)`

Creates an `OculusTree` helper for a tree record path.

### `tree.move(id, options)`

Moves a child id between parent records.

Options:

- `from`: previous parent id, or `null`.
- `to`: next parent id, or `null`.
- `at`: optional target index in the next parent's `children` array.

## Presence

Presence is ephemeral user state. It is not persisted in snapshots or replay.

```ts
room.presence.update({
  cursor: { x: 200, y: 400 },
  selectedNodeId: "node_1",
  name: "Ada",
  color: "#2563eb"
});
```

### `presence.update(data, options?)`

Sends presence data to other connected clients.

Options:

- `throttle`: minimum milliseconds between presence sends. Default is `40`.

### `presence.onChange(handler)`

Subscribes to presence broadcasts.

### `presence.lock(path)`

Low-level lock helper for a raw path. Prefer `collection.lock(id, field)` in normal app code.

```ts
const lock = await room.presence.lock("nodes.node_1.lockedBy");
await lock.release();
```

## Events And Replay

```ts
const events = await room.getEvents();
const stateAtVersion = await room.replayAt(2);
```

### `room.getEvents()`

Fetches the room event log from the server.

### `room.replayAt(version)`

Fetches reconstructed room state at a specific version.

Replay uses snapshots plus the event log when the server is running with persistent storage.

## Advanced Engine API

Most apps should start with `collection`, `text`, `list`, `tree`, and `presence`. Use this section when you are writing adapters, importing external CRDT updates, building specialized editors, or testing engine behavior directly.

### `room.apply(operations)`

Applies raw operations through the same optimistic, rollback, offline queueing, and server-ack flow as the friendly helpers.

```ts
await room.apply([
  { op: "set", path: "nodes.node_1.x", value: 220 },
  { op: "text", path: "nodes.node_1.label", value: { index: 5, insert: " here" } }
]);
```

### `Operation`

```ts
type Operation =
  | { op: "insert" | "update" | "set"; path: string; value: unknown }
  | { op: "delete"; path: string; value?: unknown }
  | {
      op: "tombstone-delete";
      path: string;
      value?: { deletedBy?: string; deletedAt?: number };
    }
  | {
      op: "text";
      path: string;
      value: {
        index?: number;
        insert?: string;
        delete?: number;
        yjsUpdate?: number[];
      };
    }
  | { op: "list-move"; path: string; value: { from: number; to: number } }
  | {
      op: "tree-move";
      path: string;
      value: {
        id: string;
        fromParentId: string | null;
        toParentId: string | null;
        toIndex?: number;
      };
    }
  | { op: "lock"; path: string; value: { owner: string | null } };
```

Operations use dot paths such as `nodes.node_1.x`.

- `set`: canonical object or field write.
- `insert` and `update`: legacy aliases still accepted by the SDK and server.
- `delete`: removes the value at a path.
- `tombstone-delete`: marks an object as deleted while preserving metadata so stale offline child updates are ignored.
- `text`: applies a text splice or native Yjs update. On server fields configured as `{ strategy: "crdt-text" }`, Oculus applies updates through a Yjs text document and stores the materialized string in room state, snapshots, events, and replay.
- `list-move`: moves an array item from one index to another.
- `tree-move`: moves a node between parent records with `children` arrays.
- `lock`: writes or clears an owner at a lock path.

### Operation Helper Functions

```ts
createCollectionOperations("nodes", "node_1", "update", { x: 220 });
createTextOperation("nodes.node_1.label", { index: 5, insert: " here" });
createYjsTextOperation("docs.doc_1.body", Array.from(update));
createListMoveOperation("layers", 3, 1);
createTreeMoveOperation("tree", "node_1", "root", "group_1", 0);
createTombstoneDeleteOperation("nodes.node_1", { deletedBy: "ada" });
```

### `applyOperations(state, operations)`

Applies operations immutably to a local state object. This is useful for tests, adapters, and offline preview logic.

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

- `OculusClientOptions`: options for `createClient`.
- `RoomOptions`: options for `client.room`, currently including optional Zod schema validation.
- `OculusClient`: client object returned by `createClient`.
- `OculusRoom<S>`: room object returned by `client.room`.
- `OculusCollection<T>`: collection helper returned by `room.collection` and `room.items`.
- `OculusTextField`: text helper returned by `collection.text`.
- `OculusList`: ordered-list helper returned by `room.list`.
- `OculusTree`: tree helper returned by `room.tree`.
- `StringFieldName<T>`: string-key helper used by `collection.text`.
- `FieldName<T>`: string-key helper used by `collection.lock`.
- `RemoveOptions`: options for `collection.remove`.
- `TreeMoveOptions`: options for `tree.move`.
- `RoomEvent`: server event-log entry for a mutation.
- `PresenceUser`: connected user record with `userId`, `clientId`, and latest presence data.
