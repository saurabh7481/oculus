import { derived, get, writable, type Readable } from "svelte/store";
import type {
  ConnectionStatus,
  CursorAwareness,
  OculusClient,
  PresenceUser,
  ReplayDiff,
  RoomEvent,
  RoomOptions,
  SyncState,
  TransactionOptions,
  ViewportAwareness,
  Operation
} from "@oculus/sdk";

export type CursorPresence = {
  x: number;
  y: number;
  color?: string;
  name?: string;
};

export type OculusRoomStore<S extends Record<string, unknown>> = {
  state: Readable<S>;
  version: Readable<number>;
  connected: Readable<boolean>;
  connectionStatus: Readable<ConnectionStatus>;
  syncState: Readable<SyncState>;
  queuedOperations: Readable<number>;
  syncing: Readable<boolean>;
  users: Readable<PresenceUser[]>;
  cursors: Readable<Record<string, CursorPresence>>;
  events: Readable<RoomEvent[]>;
  ready: Readable<boolean>;
  insert: (collection: string, id: string, data: Record<string, unknown>) => Promise<void>;
  update: (collection: string, id: string, data: Record<string, unknown>) => Promise<void>;
  remove: (collection: string, id: string) => Promise<void>;
  transaction: (
    label: string,
    operations: Operation[],
    options?: TransactionOptions
  ) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  updateCursor: (cursor: CursorAwareness, data?: { name?: string; color?: string }) => void;
  updateViewport: (viewport: ViewportAwareness) => void;
  updateSelection: (ids: string[]) => void;
  updateTool: (tool: string | null) => void;
  updateEditing: (path: string | null) => void;
  updatePresence: (data: Record<string, unknown>, options?: { throttle?: number }) => void;
  replayAt: (version: number) => Promise<S>;
  diffVersions: (fromVersion: number, toVersion: number) => Promise<ReplayDiff<S>>;
  refreshEvents: () => Promise<void>;
  disconnect: () => void;
};

export function createOculusRoomStore<S extends Record<string, unknown>>(
  client: OculusClient,
  roomId: string,
  options?: RoomOptions<S>
): OculusRoomStore<S> {
  const room = client.room<S>(roomId, options);
  const state = writable<S>({} as S);
  const version = writable(0);
  const connected = writable(false);
  const syncState = writable<SyncState>(room.getSyncState());
  const connectionStatus = writable<ConnectionStatus>(room.getSyncState().status);
  const queuedOperations = writable(room.getSyncState().queuedOperations);
  const users = writable<PresenceUser[]>([]);
  const cursors = writable<Record<string, CursorPresence>>({});
  const events = writable<RoomEvent[]>([]);
  const ready = derived([connected, state], ([$connected]) => $connected);
  const syncing = derived(syncState, ($syncState) => $syncState.status === "syncing");

  const setSyncState = (nextSyncState: SyncState) => {
    syncState.set(nextSyncState);
    connectionStatus.set(nextSyncState.status);
    queuedOperations.set(nextSyncState.queuedOperations);
    connected.set(nextSyncState.connected);
    version.set(nextSyncState.version);
  };

  const refreshEvents = async () => {
    events.set(await room.getEvents());
  };

  room.on<S>("state_change", (nextState) => {
    state.set(nextState);
    version.set(room.getVersion());
    void refreshEvents().catch(() => undefined);
  });

  room.on<boolean>("connection_change", connected.set);
  room.on<SyncState>("sync_state_change", setSyncState);
  room.on<PresenceUser[]>("users_change", users.set);
  room.on<{
    userId: string;
    clientId: string;
    data: { cursor?: { x: number; y: number }; color?: string; name?: string };
  }>("presence_change", (message) => {
    if (!message.data.cursor) return;
    cursors.update((current) => ({
      ...current,
      [message.clientId]: {
        ...message.data.cursor!,
        color: message.data.color,
        name: message.data.name ?? message.userId
      }
    }));
  });

  void room
    .connect()
    .then(async () => {
      state.set(room.getState());
      version.set(room.getVersion());
      setSyncState(room.getSyncState());
      await refreshEvents();
    })
    .catch(() => setSyncState(room.getSyncState()));

  return {
    state,
    version,
    connected,
    connectionStatus,
    syncState,
    queuedOperations,
    syncing,
    users,
    cursors,
    events,
    ready,
    insert: async (collection, id, data) => {
      await room.stateApi.collection(collection).insert(id, data);
    },
    update: async (collection, id, data) => {
      await room.stateApi.collection(collection).update(id, data);
    },
    remove: async (collection, id) => {
      await room.stateApi.collection(collection).delete(id);
    },
    transaction: async (label, operations, options) => {
      await room.transaction(label, operations, options);
    },
    undo: async () => {
      await room.undo();
    },
    redo: async () => {
      await room.redo();
    },
    updateCursor: (cursor, data) => room.awareness.updateCursor(cursor, data),
    updateViewport: (viewport) => room.awareness.updateViewport(viewport),
    updateSelection: (ids) => room.awareness.updateSelection(ids),
    updateTool: (tool) => room.awareness.updateTool(tool),
    updateEditing: (path) => room.awareness.updateEditing(path),
    updatePresence: (data, options) => room.presence.update(data, options),
    replayAt: (targetVersion) => room.replayAt(targetVersion),
    diffVersions: (fromVersion, toVersion) => room.diffVersions(fromVersion, toVersion),
    refreshEvents,
    disconnect: () => {
      connected.set(false);
      room.disconnect();
    }
  };
}

export function getRoomSnapshot<S extends Record<string, unknown>>(
  store: OculusRoomStore<S>
): S {
  return get(store.state);
}
