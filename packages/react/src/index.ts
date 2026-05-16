import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OculusClient, OculusRoom, PresenceUser, RoomEvent } from "@oculus/sdk";

export type UseOculusRoomResult<S> = {
  state: S;
  version: number;
  connected: boolean;
  users: PresenceUser[];
  cursors: Record<string, { x: number; y: number; color?: string; name?: string }>;
  events: RoomEvent[];
  insert: (collection: string, id: string, data: Record<string, unknown>) => Promise<void>;
  update: (collection: string, id: string, data: Record<string, unknown>) => Promise<void>;
  remove: (collection: string, id: string) => Promise<void>;
  updatePresence: (data: Record<string, unknown>, options?: { throttle?: number }) => void;
  replayAt: (version: number) => Promise<S>;
  refreshEvents: () => Promise<void>;
};

export function useOculusRoom<S extends Record<string, unknown>>(
  client: OculusClient,
  roomId: string
): UseOculusRoomResult<S> {
  const roomRef = useRef<OculusRoom<S> | null>(null);
  const [state, setState] = useState<S>({} as S);
  const [version, setVersion] = useState(0);
  const [connected, setConnected] = useState(false);
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const [cursors, setCursors] = useState<
    Record<string, { x: number; y: number; color?: string; name?: string }>
  >({});

  useEffect(() => {
    const room = client.room<S>(roomId);
    roomRef.current = room;

    const unsubState = room.on<S>("state_change", (nextState) => {
      setState(nextState);
      setVersion(room.getVersion());
      void room.getEvents().then(setEvents).catch(() => undefined);
    });
    const unsubConnection = room.on<boolean>("connection_change", setConnected);
    const unsubUsers = room.on<PresenceUser[]>("users_change", setUsers);
    const unsubPresence = room.on<{
      userId: string;
      clientId: string;
      data: { cursor?: { x: number; y: number }; color?: string; name?: string };
    }>("presence_change", (msg) => {
      const cursor = msg.data.cursor;
      if (!cursor) return;
      setCursors((current) => ({
        ...current,
        [msg.clientId]: {
          ...cursor,
          color: msg.data.color,
          name: msg.data.name ?? msg.userId
        }
      }));
    });

    room.connect().then(() => {
      setConnected(room.isConnected());
      setState(room.getState());
      setVersion(room.getVersion());
      return room.getEvents().then(setEvents);
    }).catch(() => setConnected(false));

    return () => {
      unsubState();
      unsubConnection();
      unsubUsers();
      unsubPresence();
      room.disconnect();
      roomRef.current = null;
    };
  }, [client, roomId]);

  const insert = useCallback(async (collection: string, id: string, data: Record<string, unknown>) => {
    await roomRef.current?.stateApi.collection(collection).insert(id, data);
  }, []);

  const update = useCallback(async (collection: string, id: string, data: Record<string, unknown>) => {
    await roomRef.current?.stateApi.collection(collection).update(id, data);
  }, []);

  const remove = useCallback(async (collection: string, id: string) => {
    await roomRef.current?.stateApi.collection(collection).delete(id);
  }, []);

  const updatePresence = useCallback(
    (data: Record<string, unknown>, options?: { throttle?: number }) => {
      roomRef.current?.presence.update(data, options);
    },
    []
  );

  const replayAt = useCallback(async (targetVersion: number): Promise<S> => {
    const replay = await roomRef.current?.replayAt(targetVersion);
    return (replay ?? ({} as S));
  }, []);

  const refreshEvents = useCallback(async () => {
    const nextEvents = await roomRef.current?.getEvents();
    setEvents(nextEvents ?? []);
  }, []);

  return useMemo(
    () => ({
      state,
      version,
      connected,
      users,
      cursors,
      events,
      insert,
      update,
      remove,
      updatePresence,
      replayAt,
      refreshEvents
    }),
    [
      state,
      version,
      connected,
      users,
      cursors,
      events,
      insert,
      update,
      remove,
      updatePresence,
      replayAt,
      refreshEvents
    ]
  );
}
