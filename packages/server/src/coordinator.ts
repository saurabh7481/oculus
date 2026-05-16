export type Operation = {
  op: "insert" | "update" | "delete";
  path: string;
  value?: unknown;
};

export type ConflictMeta = {
  roomId: string;
  currentVersion: number;
  incomingVersion: number;
  userId: string;
  timestamp: number;
};

export type FieldStrategy =
  | { strategy: "lww" }
  | { strategy: "crdt-text" }
  | {
      strategy: "custom";
      resolver: (
        current: unknown,
        incoming: unknown,
        meta: ConflictMeta
      ) => unknown;
    };

export type CollectionConfig = {
  fields?: Record<string, FieldStrategy>;
};

export type RoomEvent = {
  roomId: string;
  userId: string;
  clientId: string;
  operationId: string;
  version: number;
  operations: Operation[];
  timestamp: number;
};

type RoomCacheEntry = {
  version: number;
  state: Record<string, unknown>;
  initialState: Record<string, unknown>;
  connectedClients: Map<string, { userId: string; presence: Record<string, unknown> }>;
  lastAccess: number;
};

export interface EventStore {
  loadInitialState(roomId: string): Promise<Record<string, unknown> | undefined>;
  saveInitialState(roomId: string, state: Record<string, unknown>): Promise<void>;
  appendEvent(event: RoomEvent): Promise<void>;
  getEvents(roomId: string, afterVersion?: number): Promise<RoomEvent[]>;
  saveSnapshot(roomId: string, version: number, state: Record<string, unknown>): Promise<void>;
}

export class MemoryEventStore implements EventStore {
  private initialStates = new Map<string, Record<string, unknown>>();
  private events = new Map<string, RoomEvent[]>();
  private snapshots = new Map<string, Array<{ version: number; state: Record<string, unknown> }>>();

  async loadInitialState(roomId: string): Promise<Record<string, unknown> | undefined> {
    const state = this.initialStates.get(roomId);
    return state ? clone(state) : undefined;
  }

  async saveInitialState(roomId: string, state: Record<string, unknown>): Promise<void> {
    if (!this.initialStates.has(roomId)) {
      this.initialStates.set(roomId, clone(state));
    }
  }

  async appendEvent(event: RoomEvent): Promise<void> {
    const events = this.events.get(event.roomId) ?? [];
    events.push({ ...event, operations: clone(event.operations) });
    this.events.set(event.roomId, events);
  }

  async getEvents(roomId: string, afterVersion = 0): Promise<RoomEvent[]> {
    return (this.events.get(roomId) ?? [])
      .filter((event) => event.version > afterVersion)
      .map((event) => ({ ...event, operations: clone(event.operations) }));
  }

  async saveSnapshot(
    roomId: string,
    version: number,
    state: Record<string, unknown>
  ): Promise<void> {
    const snapshots = this.snapshots.get(roomId) ?? [];
    snapshots.push({ version, state: clone(state) });
    this.snapshots.set(roomId, snapshots);
  }
}

export class RoomCoordinator {
  private rooms = new Map<string, RoomCacheEntry>();
  private collectionConfigs = new Map<string, CollectionConfig>();

  constructor(private readonly store: EventStore = new MemoryEventStore()) {}

  defineCollection(name: string, config: CollectionConfig): void {
    this.collectionConfigs.set(name, config);
  }

  async loadRoom(roomId: string, defaultState: Record<string, unknown> = {}): Promise<{
    version: number;
    state: Record<string, unknown>;
    connectedUsers: Array<{ userId: string; clientId: string; presence: Record<string, unknown> }>;
  }> {
    const cached = this.rooms.get(roomId);
    if (cached) {
      cached.lastAccess = Date.now();
      return {
        version: cached.version,
        state: clone(cached.state),
        connectedUsers: this.getConnectedUsers(roomId)
      };
    }

    const initialState = (await this.store.loadInitialState(roomId)) ?? clone(defaultState);
    await this.store.saveInitialState(roomId, initialState);

    let version = 0;
    let state = clone(initialState);
    for (const event of await this.store.getEvents(roomId, 0)) {
      state = this.applyOperations(state, event.operations, {
        roomId,
        currentVersion: version,
        incomingVersion: event.version - 1,
        userId: event.userId,
        timestamp: event.timestamp
      });
      version = event.version;
    }

    this.rooms.set(roomId, {
      version,
      state,
      initialState,
      connectedClients: new Map(),
      lastAccess: Date.now()
    });

    return { version, state: clone(state), connectedUsers: [] };
  }

  async applyMutation(params: {
    roomId: string;
    userId: string;
    clientId: string;
    operationId: string;
    baseVersion: number;
    operations: Operation[];
  }): Promise<
    | {
        status: "accepted";
        serverVersion: number;
        transformedOperations: Operation[];
        state: Record<string, unknown>;
      }
    | { status: "rejected"; reason: string }
  > {
    const room = this.rooms.get(params.roomId);
    if (!room) {
      return { status: "rejected", reason: "room_not_loaded" };
    }

    const transformedOperations = this.transformOperations(
      params.operations,
      params.baseVersion,
      room.version
    );
    const serverVersion = room.version + 1;
    const timestamp = Date.now();

    const nextState = this.applyOperations(room.state, transformedOperations, {
      roomId: params.roomId,
      currentVersion: room.version,
      incomingVersion: params.baseVersion,
      userId: params.userId,
      timestamp
    });

    await this.store.appendEvent({
      roomId: params.roomId,
      userId: params.userId,
      clientId: params.clientId,
      operationId: params.operationId,
      version: serverVersion,
      operations: transformedOperations,
      timestamp
    });

    room.version = serverVersion;
    room.state = nextState;
    room.lastAccess = timestamp;

    if (serverVersion % 100 === 0) {
      void this.store.saveSnapshot(params.roomId, serverVersion, nextState);
    }

    return {
      status: "accepted",
      serverVersion,
      transformedOperations,
      state: clone(nextState)
    };
  }

  getRoomState(roomId: string): Record<string, unknown> | undefined {
    const room = this.rooms.get(roomId);
    return room ? clone(room.state) : undefined;
  }

  getRoomVersion(roomId: string): number {
    return this.rooms.get(roomId)?.version ?? 0;
  }

  getConnectedUsers(roomId: string): Array<{
    userId: string;
    clientId: string;
    presence: Record<string, unknown>;
  }> {
    const room = this.rooms.get(roomId);
    if (!room) return [];

    return [...room.connectedClients.entries()].map(([clientId, entry]) => ({
      clientId,
      userId: entry.userId,
      presence: clone(entry.presence)
    }));
  }

  onClientJoin(roomId: string, userId: string, clientId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.connectedClients.set(clientId, { userId, presence: {} });
  }

  async onClientLeave(roomId: string, clientId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.connectedClients.delete(clientId);
    if (room.connectedClients.size === 0) {
      await this.store.saveSnapshot(roomId, room.version, room.state);
    }
  }

  updatePresence(roomId: string, clientId: string, data: Record<string, unknown>): void {
    const room = this.rooms.get(roomId);
    const client = room?.connectedClients.get(clientId);
    if (!client) return;
    client.presence = { ...client.presence, ...data };
  }

  async getEvents(roomId: string, afterVersion = 0): Promise<RoomEvent[]> {
    return this.store.getEvents(roomId, afterVersion);
  }

  async replayAt(roomId: string, version: number): Promise<Record<string, unknown>> {
    const room = this.rooms.get(roomId);
    const initialState =
      room?.initialState ?? (await this.store.loadInitialState(roomId)) ?? {};
    let state = clone(initialState);

    for (const event of await this.store.getEvents(roomId, 0)) {
      if (event.version > version) break;
      state = this.applyOperations(state, event.operations, {
        roomId,
        currentVersion: event.version - 1,
        incomingVersion: event.version - 1,
        userId: event.userId,
        timestamp: event.timestamp
      });
    }

    return state;
  }

  private transformOperations(
    operations: Operation[],
    _baseVersion: number,
    _currentVersion: number
  ): Operation[] {
    return clone(operations);
  }

  private applyOperations(
    state: Record<string, unknown>,
    operations: Operation[],
    meta: ConflictMeta
  ): Record<string, unknown> {
    return operations.reduce(
      (nextState, operation) => this.applyOperation(nextState, operation, meta),
      clone(state)
    );
  }

  private applyOperation(
    state: Record<string, unknown>,
    operation: Operation,
    meta: ConflictMeta
  ): Record<string, unknown> {
    if (operation.op === "delete") {
      return deletePath(state, operation.path);
    }

    if (operation.op === "insert") {
      return setPath(state, operation.path, operation.value);
    }

    const strategy = this.getFieldStrategy(operation.path);
    if (strategy?.strategy === "custom") {
      const current = getPath(state, operation.path);
      return setPath(state, operation.path, strategy.resolver(current, operation.value, meta));
    }

    return setPath(state, operation.path, operation.value);
  }

  private getFieldStrategy(path: string): FieldStrategy | undefined {
    const [collection, , field] = path.split(".");
    if (!collection || !field) return undefined;
    return this.collectionConfigs.get(collection)?.fields?.[field];
  }
}

export function getPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (typeof acc !== "object" || acc === null) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

export function setPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): Record<string, unknown> {
  const next = clone(obj);
  const keys = path.split(".");
  let cursor: Record<string, unknown> = next;

  for (const key of keys.slice(0, -1)) {
    if (typeof cursor[key] !== "object" || cursor[key] === null) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }

  cursor[keys[keys.length - 1] ?? ""] = value;
  return next;
}

export function deletePath(obj: Record<string, unknown>, path: string): Record<string, unknown> {
  const next = clone(obj);
  const keys = path.split(".");
  let cursor: Record<string, unknown> | undefined = next;

  for (const key of keys.slice(0, -1)) {
    const value = cursor?.[key];
    if (typeof value !== "object" || value === null) return next;
    cursor = value as Record<string, unknown>;
  }

  if (cursor) {
    delete cursor[keys[keys.length - 1] ?? ""];
  }

  return next;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
