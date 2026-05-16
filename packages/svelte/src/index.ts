import { derived, get, writable, type Readable } from "svelte/store";
import type { OculusClient, OculusRoom, PresenceUser, RoomEvent } from "@oculus/sdk";

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
  users: Readable<PresenceUser[]>;
  cursors: Readable<Record<string, CursorPresence>>;
  events: Readable<RoomEvent[]>;
  ready: Readable<boolean>;
  insert: (collection: string, id: string, data: Record<string, unknown>) => Promise<void>;
  update: (collection: string, id: string, data: Record<string, unknown>) => Promise<void>;
  remove: (collection: string, id: string) => Promise<void>;
  updatePresence: (data: Record<string, unknown>, options?: { throttle?: number }) => void;
  replayAt: (version: number) => Promise<S>;
  refreshEvents: () => Promise<void>;
  disconnect: () => void;
};

export function createOculusRoomStore<S extends Record<string, unknown>>(
  client: OculusClient,
  roomId: string
): OculusRoomStore<S> {
  const room = client.room<S>(roomId);
  const state = writable<S>({} as S);
  const version = writable(0);
  const connected = writable(false);
  const users = writable<PresenceUser[]>([]);
  const cursors = writable<Record<string, CursorPresence>>({});
  const events = writable<RoomEvent[]>([]);
  const ready = derived([connected, state], ([$connected]) => $connected);

  const refreshEvents = async () => {
    events.set(await room.getEvents());
  };

  room.on<S>("state_change", (nextState) => {
    state.set(nextState);
    version.set(room.getVersion());
    void refreshEvents().catch(() => undefined);
  });

  room.on<boolean>("connection_change", connected.set);
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
      connected.set(room.isConnected());
      await refreshEvents();
    })
    .catch(() => connected.set(false));

  return {
    state,
    version,
    connected,
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
    updatePresence: (data, options) => room.presence.update(data, options),
    replayAt: (targetVersion) => room.replayAt(targetVersion),
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
