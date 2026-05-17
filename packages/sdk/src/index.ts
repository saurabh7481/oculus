import type { z } from "zod";

export type TextOperationValue = {
  index?: number;
  insert?: string;
  delete?: number;
  yjsUpdate?: number[];
};

export type ListMoveOperationValue = {
  from: number;
  to: number;
};

export type LockOperationValue = {
  owner: string | null;
};

export type TombstoneDeleteOperationValue = {
  deletedBy?: string;
  deletedAt?: number;
};

export type TreeMoveOperationValue = {
  id: string;
  fromParentId: string | null;
  toParentId: string | null;
  toIndex?: number;
};

export type Operation =
  | {
      op: "insert" | "update" | "set";
      path: string;
      value: unknown;
    }
  | {
      op: "delete";
      path: string;
      value?: unknown;
    }
  | {
      op: "text";
      path: string;
      value: TextOperationValue;
    }
  | {
      op: "list-move";
      path: string;
      value: ListMoveOperationValue;
    }
  | {
      op: "lock";
      path: string;
      value: LockOperationValue;
    }
  | {
      op: "tombstone-delete";
      path: string;
      value?: TombstoneDeleteOperationValue;
    }
  | {
      op: "tree-move";
      path: string;
      value: TreeMoveOperationValue;
    };

type CollectionOperation = "insert" | "update" | "delete";

export type StringFieldName<T> = Extract<
  {
    [K in keyof T]-?: NonNullable<T[K]> extends string ? K : never;
  }[keyof T],
  string
>;

export type FieldName<T> = Extract<keyof T, string>;

export type RemoveOptions = {
  preserveHistory?: boolean;
  deletedBy?: string;
  deletedAt?: number;
};

export type TreeMoveOptions = {
  from: string | null;
  to: string | null;
  at?: number;
};

type RoomMutationApi = {
  apply(operations: Operation[], options?: ApplyOptions): Promise<unknown>;
  presence: {
    lock(path: string): Promise<{ acquired: boolean; release: () => Promise<unknown> }>;
  };
};

export type RoomEvent = {
  roomId: string;
  userId: string;
  clientId: string;
  operationId: string;
  version: number;
  operations: Operation[];
  timestamp: number;
  metadata?: MutationMetadata;
};

export type MutationMetadata = {
  label?: string;
  kind?: string;
  targetIds?: string[];
  inverseOperations?: Operation[];
  undoOf?: string;
  redoOf?: string;
};

export type ApplyOptions = {
  metadata?: MutationMetadata;
  trackUndo?: boolean;
};

export type TransactionOptions = Omit<MutationMetadata, "label" | "inverseOperations"> & {
  trackUndo?: boolean;
};

export type CursorAwareness = {
  x: number;
  y: number;
};

export type ViewportAwareness = {
  x: number;
  y: number;
  zoom: number;
  pageId?: string;
};

export type CommentTarget = {
  targetId?: string;
  x?: number;
  y?: number;
  path?: string;
};

export type OculusComment = CommentTarget & {
  id: string;
  body: string;
  authorId?: string;
  parentId?: string;
  resolved: boolean;
  createdAt: number;
  updatedAt: number;
};

export type AssetReference = {
  id: string;
  kind: "image" | "font" | "file" | "video" | "audio" | "other";
  url: string;
  width?: number;
  height?: number;
  mimeType?: string;
  metadata?: Record<string, unknown>;
};

export type CanvasPoint = {
  x: number;
  y: number;
};

export type CanvasShape = {
  id: string;
  type: "rectangle" | "ellipse" | "sticky" | "text" | "frame" | "image" | "freehand" | string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation?: number;
  text?: string;
  assetId?: string;
  points?: CanvasPoint[];
  style?: Record<string, unknown>;
};

export type ReplayDiffChange = {
  path: string;
  before: unknown;
  after: unknown;
  kind: "added" | "removed" | "changed";
};

export type ReplayDiff<S = Record<string, unknown>> = {
  roomId: string;
  fromVersion: number;
  toVersion: number;
  fromState?: S;
  toState?: S;
  events: RoomEvent[];
  changedPaths: string[];
  changes: ReplayDiffChange[];
};

export type OculusClientOptions = {
  serverUrl: string;
  authToken?: string;
  userId?: string;
  roles?: string[];
};

export type ConnectionStatus = "offline" | "connecting" | "connected" | "reconnecting" | "syncing";

export type ReconnectOptions = {
  enabled?: boolean;
  minDelay?: number;
  maxDelay?: number;
  jitter?: number;
};

export type SyncState = {
  status: ConnectionStatus;
  connected: boolean;
  queuedOperations: number;
  pendingOperations: number;
  version: number;
};

export type RoomOptions<S = Record<string, unknown>> = {
  schema?: z.ZodType<S>;
  reconnect?: ReconnectOptions;
};

type Handler<T = unknown> = (payload: T) => void;

type ServerMessage =
  | {
      type: "room_init";
      version: number;
      state: Record<string, unknown>;
      connectedUsers: PresenceUser[];
    }
  | {
      type: "mutation_ack";
      operationId: string;
      serverVersion?: number;
      status: "accepted" | "rejected";
      reason?: string;
      transformedOperations?: Operation[];
    }
  | {
      type: "mutation_broadcast";
      serverVersion: number;
      userId: string;
      clientId: string;
      operations: Operation[];
    }
  | {
      type: "presence_broadcast";
      userId: string;
      clientId: string;
      data: Record<string, unknown>;
      ts: number;
    }
  | {
      type: "users_change";
      users: PresenceUser[];
      userId: string;
      clientId: string;
      action: "joined" | "left";
    };

export type PresenceUser = {
  userId: string;
  clientId: string;
  presence: Record<string, unknown>;
};

export function createClient(options: OculusClientOptions): OculusClient {
  return new OculusClient(options);
}

export class OculusClient {
  constructor(private readonly options: OculusClientOptions) {}

  room<S = Record<string, unknown>>(roomId: string, options?: RoomOptions<S>): OculusRoom<S> {
    return new OculusRoom<S>(roomId, this.options, options);
  }
}

export class OculusRoom<S = Record<string, unknown>> {
  private socket: WebSocket | null = null;
  private state = {} as S;
  private version = 0;
  private connected = false;
  private connectionStatus: ConnectionStatus = "offline";
  private clientId = getOrCreateClientId();
  private pending = new Map<
    string,
    {
      operations: Operation[];
      previousState: S;
      metadata?: MutationMetadata;
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
    }
  >();
  private offlineQueue: Array<{ operations: Operation[]; metadata?: MutationMetadata }> = [];
  private undoStack: Array<{ label: string; operations: Operation[]; inverseOperations: Operation[] }> = [];
  private redoStack: Array<{ label: string; operations: Operation[]; inverseOperations: Operation[] }> = [];
  private handlers = new Map<string, Set<Handler>>();
  private lastPresenceSend = 0;
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private queuedPresence: Record<string, unknown> | null = null;
  private connectPromise: Promise<void> | null = null;
  private manualDisconnect = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private flushingQueueCount = 0;

  constructor(
    private readonly roomId: string,
    private readonly clientOptions: OculusClientOptions,
    private readonly roomOptions?: RoomOptions<S>
  ) {}

  collection<T extends Record<string, unknown> = Record<string, unknown>>(name: string): OculusCollection<T> {
    return new OculusCollection(this, name, () => this.clientOptions.userId ?? this.clientId);
  }

  items<T extends Record<string, unknown> = Record<string, unknown>>(name: string): OculusCollection<T> {
    return this.collection<T>(name);
  }

  list(path: string): OculusList {
    return new OculusList(this, path);
  }

  tree(path: string): OculusTree {
    return new OculusTree(this, path);
  }

  comments(name = "comments"): OculusComments {
    return new OculusComments(this, name, () => this.clientOptions.userId ?? this.clientId);
  }

  assets(name = "assets"): OculusAssets {
    return new OculusAssets(this, name);
  }

  shapes(name = "shapes"): OculusShapes {
    return new OculusShapes(this, name);
  }

  readonly stateApi = {
    collection: (name: string) => ({
      insert: (id: string, data: Record<string, unknown>) =>
        this.mutate(createCollectionOperations(name, id, "insert", data)),
      update: (id: string, data: Record<string, unknown>) =>
        this.mutate(createCollectionOperations(name, id, "update", data)),
      delete: (id: string) => this.mutate(createCollectionOperations(name, id, "delete"))
    })
  };

  readonly presence = {
    update: (data: Record<string, unknown>, options?: { throttle?: number }) => {
      const throttle = options?.throttle ?? 40;
      const elapsed = Date.now() - this.lastPresenceSend;

      if (elapsed >= throttle) {
        this.sendPresence(data);
        return;
      }

      this.queuedPresence = { ...(this.queuedPresence ?? {}), ...data };
      if (!this.presenceTimer) {
        this.presenceTimer = setTimeout(() => {
          if (this.queuedPresence) this.sendPresence(this.queuedPresence);
          this.queuedPresence = null;
          this.presenceTimer = null;
        }, throttle - elapsed);
      }
    },
    onChange: (handler: Handler) => this.on("presence_change", handler),
    lock: async (path: string) => {
      await this.mutate([{ op: "lock", path, value: { owner: this.clientOptions.userId ?? this.clientId } }]);
      return {
        acquired: true,
        release: () => this.mutate([{ op: "lock", path, value: { owner: null } }])
      };
    }
  };

  readonly awareness = {
    updateCursor: (cursor: CursorAwareness, data: { name?: string; color?: string } = {}) => {
      this.presence.update({ cursor, ...data }, { throttle: 0 });
    },
    updateViewport: (viewport: ViewportAwareness) => {
      this.presence.update({ viewport }, { throttle: 0 });
    },
    updateSelection: (ids: string[]) => {
      this.presence.update({ selection: { ids: [...ids] } }, { throttle: 0 });
    },
    updateTool: (tool: string | null) => {
      this.presence.update({ tool }, { throttle: 0 });
    },
    updateEditing: (path: string | null) => {
      this.presence.update({ editing: path }, { throttle: 0 });
    }
  };

  async apply(operations: Operation[], options?: ApplyOptions): Promise<unknown> {
    return this.mutate(operations, options);
  }

  async transaction(
    label: string,
    build: Operation[] | ((transaction: OculusTransaction) => void | Promise<void>),
    options: TransactionOptions = {}
  ): Promise<unknown> {
    const transaction = new OculusTransaction();
    if (Array.isArray(build)) {
      transaction.apply(build);
    } else {
      await build(transaction);
    }
    const operations = transaction.getOperations();
    return this.mutate(operations, {
      trackUndo: options.trackUndo ?? true,
      metadata: {
        label,
        kind: options.kind,
        targetIds: options.targetIds,
        undoOf: options.undoOf,
        redoOf: options.redoOf
      }
    });
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  async undo(): Promise<unknown> {
    const entry = this.undoStack.pop();
    if (!entry) return { status: "empty" };
    const result = await this.mutate(entry.inverseOperations, {
      trackUndo: false,
      metadata: {
        label: `Undo ${entry.label}`,
        kind: "undo",
        undoOf: entry.label,
        inverseOperations: entry.operations
      }
    });
    this.redoStack.push(entry);
    return result;
  }

  async redo(): Promise<unknown> {
    const entry = this.redoStack.pop();
    if (!entry) return { status: "empty" };
    const result = await this.mutate(entry.operations, {
      trackUndo: false,
      metadata: {
        label: `Redo ${entry.label}`,
        kind: "redo",
        redoOf: entry.label,
        inverseOperations: entry.inverseOperations
      }
    });
    this.undoStack.push(entry);
    return result;
  }

  async connect(): Promise<void> {
    if (this.connected && this.connectionStatus === "connected") return;
    if (this.connectPromise) return this.connectPromise;

    this.manualDisconnect = false;
    this.clearReconnectTimer();
    const status = this.connectionStatus === "reconnecting" ? "reconnecting" : "connecting";
    this.connectPromise = this.openSocket(status).finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private async openSocket(status: ConnectionStatus): Promise<void> {
    this.setConnectionStatus(status);

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.getSocketUrl());
      let initialized = false;
      this.socket = socket;

      socket.onopen = () => {
        this.connected = true;
        this.emit("connection_change", true);
      };

      socket.onerror = () => {
        if (!initialized) reject(new Error("Unable to connect to Oculus room"));
        if (!this.manualDisconnect) this.scheduleReconnect();
      };

      socket.onclose = () => {
        this.connected = false;
        this.emit("connection_change", false);
        if (!this.manualDisconnect) {
          this.scheduleReconnect();
        } else {
          this.setConnectionStatus("offline");
        }
        if (!initialized) reject(new Error("Oculus room connection closed before initialization"));
      };

      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        this.handleMessage(message);
        if (message.type === "room_init") {
          initialized = true;
          resolve();
        }
      };
    });

    this.reconnectAttempts = 0;
    if (this.offlineQueue.length > 0) this.setConnectionStatus("syncing");
    await this.flushOfflineQueue();
    this.setConnectionStatus("connected");
  }

  disconnect(): void {
    this.manualDisconnect = true;
    this.clearReconnectTimer();
    this.socket?.close();
    this.socket = null;
    this.connected = false;
    this.setConnectionStatus("offline");
  }

  getState(): S {
    return clone(this.state);
  }

  getVersion(): number {
    return this.version;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getSyncState(): SyncState {
    return {
      status: this.connectionStatus,
      connected: this.connected,
      queuedOperations: this.offlineQueue.length + this.flushingQueueCount,
      pendingOperations: this.pending.size,
      version: this.version
    };
  }

  on<T = unknown>(event: string, handler: Handler<T>): () => void {
    const handlers = this.handlers.get(event) ?? new Set<Handler>();
    handlers.add(handler as Handler);
    this.handlers.set(event, handlers);
    return () => {
      handlers.delete(handler as Handler);
    };
  }

  async getEvents(): Promise<RoomEvent[]> {
    const response = await fetch(`${this.getHttpUrl()}/rooms/${encodeURIComponent(this.roomId)}/events`);
    const payload = (await response.json()) as { events: RoomEvent[] };
    return payload.events;
  }

  async replayAt(version: number): Promise<S> {
    const response = await fetch(
      `${this.getHttpUrl()}/rooms/${encodeURIComponent(this.roomId)}/replay/${version}`
    );
    const payload = (await response.json()) as { state: S };
    return payload.state;
  }

  async diffVersions(fromVersion: number, toVersion: number): Promise<ReplayDiff<S>> {
    const response = await fetch(
      `${this.getHttpUrl()}/rooms/${encodeURIComponent(this.roomId)}/diff/${fromVersion}/${toVersion}`
    );
    const payload = (await response.json()) as { diff: ReplayDiff<S> };
    return payload.diff;
  }

  private async mutate(operations: Operation[], options: ApplyOptions = {}): Promise<unknown> {
    this.validateOperations(operations);
    const previousState = this.getState();
    const inverseOperations = createInverseOperations(previousState as Record<string, unknown>, operations);
    const metadata = {
      ...options.metadata,
      inverseOperations: options.metadata?.inverseOperations ?? inverseOperations
    };
    this.state = applyOperations(this.state as Record<string, unknown>, operations) as S;
    this.emit("state_change", this.getState());

    if (options.trackUndo && inverseOperations.length > 0) {
      this.undoStack.push({
        label: metadata.label ?? "Change",
        operations: clone(operations),
        inverseOperations
      });
      this.redoStack = [];
    }

    if (!this.connected || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.offlineQueue.push({ operations, metadata });
      this.emitSyncState();
      return { status: "queued" };
    }

    const operationId = randomId();
    return new Promise((resolve, reject) => {
      this.pending.set(operationId, { operations, previousState, metadata, resolve, reject });
      this.emitSyncState();
      this.socket?.send(
        JSON.stringify({
          type: "mutation",
          operationId,
          baseVersion: this.version,
          operations,
          metadata
        })
      );

      setTimeout(() => {
        const pending = this.pending.get(operationId);
        if (!pending) return;
        this.pending.delete(operationId);
        this.state = pending.previousState;
        this.emit("state_change", this.getState());
        this.emitSyncState();
        reject(new Error("Mutation timed out"));
      }, 10_000);
    });
  }

  private handleMessage(message: ServerMessage): void {
    if (message.type === "room_init") {
      this.version = message.version;
      this.state = message.state as S;
      this.emit("state_change", this.getState());
      this.emit("users_change", message.connectedUsers);
      this.emitSyncState();
      return;
    }

    if (message.type === "mutation_ack") {
      const pending = this.pending.get(message.operationId);
      if (!pending) return;
      this.pending.delete(message.operationId);

      if (message.status === "accepted") {
        this.version = message.serverVersion ?? this.version;
        this.emitSyncState();
        pending.resolve(message);
      } else {
        this.state = pending.previousState;
        this.emit("state_change", this.getState());
        this.emitSyncState();
        pending.reject(new Error(message.reason ?? "Mutation rejected"));
      }
      return;
    }

    if (message.type === "mutation_broadcast") {
      this.version = message.serverVersion;
      this.state = applyOperations(this.state as Record<string, unknown>, message.operations) as S;
      this.emit("state_change", this.getState());
      this.emit("remote_mutation", message);
      this.emitSyncState();
      return;
    }

    if (message.type === "presence_broadcast") {
      this.emit("presence_change", message);
      return;
    }

    if (message.type === "users_change") {
      this.emit("users_change", message.users);
    }
  }

  private async flushOfflineQueue(): Promise<void> {
    const queued = [...this.offlineQueue];
    this.offlineQueue = [];
    this.flushingQueueCount = queued.length;
    this.emitSyncState();
    for (const queuedMutation of queued) {
      await this.mutate(queuedMutation.operations, {
        metadata: queuedMutation.metadata,
        trackUndo: false
      });
      this.flushingQueueCount -= 1;
      this.emitSyncState();
    }
  }

  private scheduleReconnect(): void {
    if (this.manualDisconnect || this.reconnectTimer) return;
    if (this.roomOptions?.reconnect?.enabled === false) {
      this.setConnectionStatus("offline");
      return;
    }

    this.setConnectionStatus("reconnecting");
    const delay = this.getReconnectDelay();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => undefined);
    }, delay);
  }

  private getReconnectDelay(): number {
    const minDelay = this.roomOptions?.reconnect?.minDelay ?? 250;
    const maxDelay = this.roomOptions?.reconnect?.maxDelay ?? 5_000;
    const jitter = this.roomOptions?.reconnect?.jitter ?? 0.25;
    const exponentialDelay = Math.min(maxDelay, minDelay * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    const spread = exponentialDelay * jitter;
    return Math.max(0, Math.round(exponentialDelay - spread + Math.random() * spread * 2));
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private sendPresence(data: Record<string, unknown>): void {
    this.lastPresenceSend = Date.now();
    if (this.connected && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "presence", data }));
    }
  }

  private validateOperations(operations: Operation[]): void {
    if (!this.roomOptions?.schema) return;
    const nextState = applyOperations(this.state as Record<string, unknown>, operations);
    this.roomOptions.schema.parse(nextState);
  }

  private getSocketUrl(): string {
    const base = this.clientOptions.serverUrl.replace(/^http/, "ws").replace(/\/$/, "");
    const url = new URL(`${base}/rooms/${encodeURIComponent(this.roomId)}`);
    if (this.clientOptions.userId) url.searchParams.set("userId", this.clientOptions.userId);
    if (this.clientOptions.authToken) url.searchParams.set("token", this.clientOptions.authToken);
    if (this.clientOptions.roles?.length) url.searchParams.set("roles", this.clientOptions.roles.join(","));
    url.searchParams.set("clientId", this.clientId);
    return url.toString();
  }

  private getHttpUrl(): string {
    return this.clientOptions.serverUrl.replace(/^ws/, "http").replace(/\/$/, "");
  }

  private emit<T = unknown>(event: string, payload: T): void {
    this.handlers.get(event)?.forEach((handler) => handler(payload));
  }

  private setConnectionStatus(status: ConnectionStatus): void {
    if (this.connectionStatus === status) {
      this.emitSyncState();
      return;
    }
    this.connectionStatus = status;
    this.emitSyncState();
  }

  private emitSyncState(): void {
    this.emit("sync_state_change", this.getSyncState());
  }
}

export class OculusTransaction implements RoomMutationApi {
  private operations: Operation[] = [];

  readonly presence = {
    lock: async (_path: string) => {
      throw new Error("Locks cannot be acquired inside a transaction builder");
    }
  };

  apply(operations: Operation[]): Promise<unknown> {
    this.operations.push(...clone(operations));
    return Promise.resolve({ status: "staged" });
  }

  collection<T extends Record<string, unknown> = Record<string, unknown>>(name: string): OculusCollection<T> {
    return new OculusCollection(this, name, () => "transaction");
  }

  items<T extends Record<string, unknown> = Record<string, unknown>>(name: string): OculusCollection<T> {
    return this.collection<T>(name);
  }

  list(path: string): OculusList {
    return new OculusList(this, path);
  }

  tree(path: string): OculusTree {
    return new OculusTree(this, path);
  }

  getOperations(): Operation[] {
    return clone(this.operations);
  }
}

export class OculusCollection<T extends Record<string, unknown> = Record<string, unknown>> {
  constructor(
    private readonly room: RoomMutationApi,
    private readonly name: string,
    private readonly getActorId: () => string
  ) {}

  create(id: string, data: T): Promise<unknown> {
    return this.room.apply(createCollectionOperations(this.name, id, "insert", data));
  }

  change(id: string, data: Partial<T>): Promise<unknown> {
    return this.room.apply(createCollectionOperations(this.name, id, "update", data));
  }

  remove(id: string, options: RemoveOptions = {}): Promise<unknown> {
    if (options.preserveHistory) {
      return this.room.apply([
        createTombstoneDeleteOperation(this.pathFor(id), {
          deletedAt: options.deletedAt,
          deletedBy: options.deletedBy ?? this.getActorId()
        })
      ]);
    }

    return this.room.apply(createCollectionOperations(this.name, id, "delete"));
  }

  text(fieldId: string, field: StringFieldName<T>): OculusTextField {
    return new OculusTextField(this.room, this.pathFor(fieldId, field));
  }

  lock(fieldId: string, field: FieldName<T>): Promise<{ acquired: boolean; release: () => Promise<unknown> }> {
    return this.room.presence.lock(this.pathFor(fieldId, field));
  }

  private pathFor(id: string, field?: string): string {
    return [this.name, id, field].filter(Boolean).join(".");
  }
}

export class OculusTextField {
  constructor(
    private readonly room: Pick<RoomMutationApi, "apply">,
    private readonly path: string
  ) {}

  insert(index: number, text: string): Promise<unknown> {
    return this.room.apply([createTextOperation(this.path, { index, insert: text })]);
  }

  delete(index: number, count: number): Promise<unknown> {
    return this.room.apply([createTextOperation(this.path, { index, delete: count })]);
  }

  replace(text: string): Promise<unknown> {
    return this.room.apply([{ op: "set", path: this.path, value: text }]);
  }

  applyYjsUpdate(update: Uint8Array | number[]): Promise<unknown> {
    return this.room.apply([createYjsTextOperation(this.path, Array.from(update))]);
  }
}

export class OculusList {
  constructor(
    private readonly room: Pick<RoomMutationApi, "apply">,
    private readonly path: string
  ) {}

  move(from: number, to: number): Promise<unknown> {
    return this.room.apply([createListMoveOperation(this.path, from, to)]);
  }
}

export class OculusTree {
  constructor(
    private readonly room: Pick<RoomMutationApi, "apply">,
    private readonly path: string
  ) {}

  move(id: string, options: TreeMoveOptions): Promise<unknown> {
    return this.room.apply([createTreeMoveOperation(this.path, id, options.from, options.to, options.at)]);
  }
}

export class OculusComments {
  constructor(
    private readonly room: Pick<RoomMutationApi, "apply">,
    private readonly name: string,
    private readonly getActorId: () => string
  ) {}

  create(
    id: string,
    data: CommentTarget & { body: string; parentId?: string; resolved?: boolean; createdAt?: number; updatedAt?: number }
  ): Promise<unknown> {
    const timestamp = data.createdAt ?? Date.now();
    return this.room.apply([
      {
        op: "set",
        path: `${this.name}.${id}`,
        value: {
          ...data,
          id,
          authorId: this.getActorId(),
          resolved: data.resolved ?? false,
          createdAt: timestamp,
          updatedAt: data.updatedAt ?? timestamp
        }
      }
    ]);
  }

  reply(parentId: string, id: string, data: { body: string; createdAt?: number; updatedAt?: number }): Promise<unknown> {
    return this.create(id, {
      ...data,
      parentId,
      resolved: false
    });
  }

  resolve(id: string): Promise<unknown> {
    return this.room.apply([
      { op: "set", path: `${this.name}.${id}.resolved`, value: true },
      { op: "set", path: `${this.name}.${id}.updatedAt`, value: Date.now() }
    ]);
  }

  reopen(id: string): Promise<unknown> {
    return this.room.apply([
      { op: "set", path: `${this.name}.${id}.resolved`, value: false },
      { op: "set", path: `${this.name}.${id}.updatedAt`, value: Date.now() }
    ]);
  }
}

export class OculusAssets {
  constructor(
    private readonly room: Pick<RoomMutationApi, "apply">,
    private readonly name: string
  ) {}

  create(id: string, data: Omit<AssetReference, "id">): Promise<unknown> {
    return this.room.apply([{ op: "set", path: `${this.name}.${id}`, value: { ...data, id } }]);
  }

  updateMetadata(id: string, metadata: Record<string, unknown>): Promise<unknown> {
    return this.room.apply([{ op: "set", path: `${this.name}.${id}.metadata`, value: metadata }]);
  }

  remove(id: string): Promise<unknown> {
    return this.room.apply([{ op: "delete", path: `${this.name}.${id}` }]);
  }
}

export class OculusShapes {
  constructor(
    private readonly room: Pick<RoomMutationApi, "apply">,
    private readonly name: string
  ) {}

  create(id: string, data: Omit<CanvasShape, "id">): Promise<unknown> {
    return this.room.apply([{ op: "set", path: `${this.name}.${id}`, value: { ...data, id } }]);
  }

  change(id: string, data: Partial<CanvasShape>): Promise<unknown> {
    return this.room.apply(createCollectionOperations(this.name, id, "update", data));
  }

  move(id: string, x: number, y: number): Promise<unknown> {
    return this.change(id, { x, y });
  }

  resize(id: string, width: number, height: number): Promise<unknown> {
    return this.change(id, { width, height });
  }

  freehand(
    id: string,
    data: { points: CanvasPoint[]; style?: Record<string, unknown>; x?: number; y?: number }
  ): Promise<unknown> {
    return this.create(id, {
      type: "freehand",
      x: data.x ?? 0,
      y: data.y ?? 0,
      points: data.points,
      style: data.style
    });
  }
}

export function createCollectionOperations(
  collection: string,
  id: string,
  op: CollectionOperation,
  data?: Record<string, unknown>
): Operation[] {
  if (op === "delete") return [{ op: "delete", path: `${collection}.${id}` }];
  if (op === "insert") return [{ op: "set", path: `${collection}.${id}`, value: data ?? {} }];

  return Object.entries(data ?? {}).map(([field, value]) => ({
    op: "set",
    path: `${collection}.${id}.${field}`,
    value
  }));
}

export function createTextOperation(path: string, value: TextOperationValue): Operation {
  return { op: "text", path, value };
}

export function createYjsTextOperation(path: string, yjsUpdate: number[]): Operation {
  return { op: "text", path, value: { yjsUpdate } };
}

export function createListMoveOperation(path: string, from: number, to: number): Operation {
  return { op: "list-move", path, value: { from, to } };
}

export function createTreeMoveOperation(
  path: string,
  id: string,
  fromParentId: string | null,
  toParentId: string | null,
  toIndex?: number
): Operation {
  return { op: "tree-move", path, value: { id, fromParentId, toParentId, toIndex } };
}

export function createTombstoneDeleteOperation(
  path: string,
  value: TombstoneDeleteOperationValue = {}
): Operation {
  return { op: "tombstone-delete", path, value };
}

export function applyOperations<S extends Record<string, unknown>>(
  state: S,
  operations: Operation[]
): S {
  return operations.reduce((next, operation) => {
    if (operation.op !== "delete" && operation.op !== "tombstone-delete" && hasTombstoneAncestor(next, operation.path)) {
      return next;
    }
    if (operation.op === "delete") return deletePath(next, operation.path) as S;
    if (operation.op === "tombstone-delete") {
      return setPath(next, operation.path, applyTombstoneDelete(getPath(next, operation.path), operation.value)) as S;
    }
    if (operation.op === "text") {
      const current = getPath(next, operation.path);
      return setPath(next, operation.path, applyTextOperation(current, operation.value)) as S;
    }
    if (operation.op === "list-move") {
      const current = getPath(next, operation.path);
      return setPath(next, operation.path, applyListMoveOperation(current, operation.value)) as S;
    }
    if (operation.op === "lock") {
      return setPath(next, operation.path, operation.value.owner) as S;
    }
    if (operation.op === "tree-move") {
      const current = getPath(next, operation.path);
      return setPath(next, operation.path, applyTreeMoveOperation(current, operation.value)) as S;
    }
    return setPath(next, operation.path, operation.value) as S;
  }, clone(state));
}

export function createInverseOperations(
  state: Record<string, unknown>,
  operations: Operation[]
): Operation[] {
  let current = clone(state);
  const inverses: Operation[] = [];

  for (const operation of operations) {
    inverses.unshift(...createInverseOperation(current, operation));
    current = applyOperations(current, [operation]);
  }

  return inverses;
}

function createInverseOperation(state: Record<string, unknown>, operation: Operation): Operation[] {
  if (operation.op === "delete" || operation.op === "tombstone-delete") {
    const previous = getPath(state, operation.path);
    return previous === undefined ? [] : [{ op: "set", path: operation.path, value: previous }];
  }

  if (operation.op === "text") {
    const current = typeof getPath(state, operation.path) === "string"
      ? getPath(state, operation.path) as string
      : "";
    const index = clampInteger(operation.value.index ?? current.length, 0, current.length);
    const deleteCount = clampInteger(operation.value.delete ?? 0, 0, current.length - index);
    const deletedText = current.slice(index, index + deleteCount);
    const insertedText = operation.value.insert ?? "";
    if (!deletedText && !insertedText) return [];
    return [{
      op: "text",
      path: operation.path,
      value: {
        index,
        delete: insertedText.length || undefined,
        insert: deletedText || undefined
      }
    }];
  }

  if (operation.op === "list-move") {
    return [{
      op: "list-move",
      path: operation.path,
      value: { from: operation.value.to, to: operation.value.from }
    }];
  }

  if (operation.op === "tree-move") {
    const tree = getPath(state, operation.path);
    const fromParent = isRecord(tree) && operation.value.fromParentId
      ? asTreeNode(tree[operation.value.fromParentId])
      : undefined;
    const previousIndex = fromParent?.children.indexOf(operation.value.id);
    return [{
      op: "tree-move",
      path: operation.path,
      value: {
        id: operation.value.id,
        fromParentId: operation.value.toParentId,
        toParentId: operation.value.fromParentId,
        toIndex: previousIndex === undefined || previousIndex < 0 ? undefined : previousIndex
      }
    }];
  }

  if (operation.op === "lock") {
    return [{
      op: "lock",
      path: operation.path,
      value: { owner: (getPath(state, operation.path) as string | null | undefined) ?? null }
    }];
  }

  const previous = getPath(state, operation.path);
  if (previous === undefined) return [{ op: "delete", path: operation.path }];
  return [{ op: "set", path: operation.path, value: previous }];
}

function getPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (typeof acc !== "object" || acc === null) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
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

function deletePath(obj: Record<string, unknown>, path: string): Record<string, unknown> {
  const next = clone(obj);
  const keys = path.split(".");
  let cursor: Record<string, unknown> | undefined = next;

  for (const key of keys.slice(0, -1)) {
    const value = cursor?.[key];
    if (typeof value !== "object" || value === null) return next;
    cursor = value as Record<string, unknown>;
  }

  if (cursor) delete cursor[keys[keys.length - 1] ?? ""];
  return next;
}

function applyTextOperation(current: unknown, value: TextOperationValue): string {
  if (value.yjsUpdate) return typeof current === "string" ? current : "";
  const text = typeof current === "string" ? current : "";
  const index = clampInteger(value.index ?? text.length, 0, text.length);
  const deleteCount = clampInteger(value.delete ?? 0, 0, text.length - index);
  return `${text.slice(0, index)}${value.insert ?? ""}${text.slice(index + deleteCount)}`;
}

function applyTombstoneDelete(current: unknown, value: TombstoneDeleteOperationValue = {}): Record<string, unknown> {
  const object = typeof current === "object" && current !== null ? current as Record<string, unknown> : {};
  return {
    ...object,
    __deleted: true,
    __deletedAt: value.deletedAt ?? Date.now(),
    __deletedBy: value.deletedBy
  };
}

function applyTreeMoveOperation(current: unknown, value: TreeMoveOperationValue): Record<string, unknown> {
  if (typeof current !== "object" || current === null) return {};
  const tree = clone(current as Record<string, unknown>);
  const node = asTreeNode(tree[value.id]);
  if (!node) return tree;

  if (value.fromParentId && asTreeNode(tree[value.fromParentId])) {
    const fromParent = asTreeNode(tree[value.fromParentId])!;
    fromParent.children = fromParent.children.filter((childId) => childId !== value.id);
    tree[value.fromParentId] = fromParent;
  }

  if (value.toParentId && asTreeNode(tree[value.toParentId])) {
    const toParent = asTreeNode(tree[value.toParentId])!;
    const withoutExisting = toParent.children.filter((childId) => childId !== value.id);
    const toIndex = clampInteger(value.toIndex ?? withoutExisting.length, 0, withoutExisting.length);
    withoutExisting.splice(toIndex, 0, value.id);
    toParent.children = withoutExisting;
    tree[value.toParentId] = toParent;
  }

  node.parentId = value.toParentId;
  tree[value.id] = node;
  return tree;
}

function asTreeNode(value: unknown): (Record<string, unknown> & { children: string[] }) | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const node = value as Record<string, unknown> & { children?: unknown };
  return {
    ...node,
    children: Array.isArray(node.children) ? node.children.filter((child): child is string => typeof child === "string") : []
  };
}

function hasTombstoneAncestor(obj: Record<string, unknown>, path: string): boolean {
  const keys = path.split(".");
  for (let index = keys.length - 1; index > 0; index--) {
    const candidate = getPath(obj, keys.slice(0, index).join("."));
    if (
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as Record<string, unknown>).__deleted === true
    ) {
      return true;
    }
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function applyListMoveOperation(current: unknown, value: ListMoveOperationValue): unknown[] {
  if (!Array.isArray(current) || current.length === 0) return Array.isArray(current) ? [...current] : [];
  const next = [...current];
  const from = clampInteger(value.from, 0, next.length - 1);
  const [item] = next.splice(from, 1);
  const to = clampInteger(value.to, 0, next.length);
  next.splice(to, 0, item);
  return next;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function getOrCreateClientId(): string {
  if (typeof sessionStorage === "undefined") return randomId();
  const existing = sessionStorage.getItem("oculus_client_id");
  if (existing) return existing;
  const id = randomId();
  sessionStorage.setItem("oculus_client_id", id);
  return id;
}

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
