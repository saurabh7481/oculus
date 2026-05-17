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
  apply(operations: Operation[]): Promise<unknown>;
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
};

export type OculusClientOptions = {
  serverUrl: string;
  authToken?: string;
  userId?: string;
};

export type RoomOptions<S = Record<string, unknown>> = {
  schema?: z.ZodType<S>;
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
  private clientId = getOrCreateClientId();
  private pending = new Map<
    string,
    {
      operations: Operation[];
      previousState: S;
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
    }
  >();
  private offlineQueue: Operation[][] = [];
  private handlers = new Map<string, Set<Handler>>();
  private lastPresenceSend = 0;
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private queuedPresence: Record<string, unknown> | null = null;

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

  async apply(operations: Operation[]): Promise<unknown> {
    return this.mutate(operations);
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.getSocketUrl());
      this.socket = socket;

      socket.onopen = () => {
        this.connected = true;
        this.emit("connection_change", true);
      };

      socket.onerror = () => {
        reject(new Error("Unable to connect to Oculus room"));
      };

      socket.onclose = () => {
        this.connected = false;
        this.emit("connection_change", false);
      };

      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        this.handleMessage(message);
        if (message.type === "room_init") resolve();
      };
    });

    await this.flushOfflineQueue();
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
    this.connected = false;
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

  private async mutate(operations: Operation[]): Promise<unknown> {
    this.validateOperations(operations);
    const previousState = this.getState();
    this.state = applyOperations(this.state as Record<string, unknown>, operations) as S;
    this.emit("state_change", this.getState());

    if (!this.connected || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.offlineQueue.push(operations);
      return { status: "queued" };
    }

    const operationId = randomId();
    return new Promise((resolve, reject) => {
      this.pending.set(operationId, { operations, previousState, resolve, reject });
      this.socket?.send(
        JSON.stringify({
          type: "mutation",
          operationId,
          baseVersion: this.version,
          operations
        })
      );

      setTimeout(() => {
        const pending = this.pending.get(operationId);
        if (!pending) return;
        this.pending.delete(operationId);
        this.state = pending.previousState;
        this.emit("state_change", this.getState());
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
      return;
    }

    if (message.type === "mutation_ack") {
      const pending = this.pending.get(message.operationId);
      if (!pending) return;
      this.pending.delete(message.operationId);

      if (message.status === "accepted") {
        this.version = message.serverVersion ?? this.version;
        pending.resolve(message);
      } else {
        this.state = pending.previousState;
        this.emit("state_change", this.getState());
        pending.reject(new Error(message.reason ?? "Mutation rejected"));
      }
      return;
    }

    if (message.type === "mutation_broadcast") {
      this.version = message.serverVersion;
      this.state = applyOperations(this.state as Record<string, unknown>, message.operations) as S;
      this.emit("state_change", this.getState());
      this.emit("remote_mutation", message);
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
    for (const operations of queued) {
      await this.mutate(operations);
    }
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
    url.searchParams.set("clientId", this.clientId);
    return url.toString();
  }

  private getHttpUrl(): string {
    return this.clientOptions.serverUrl.replace(/^ws/, "http").replace(/\/$/, "");
  }

  private emit<T = unknown>(event: string, payload: T): void {
    this.handlers.get(event)?.forEach((handler) => handler(payload));
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
