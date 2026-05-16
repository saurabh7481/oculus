import type { z } from "zod";

export type Operation = {
  op: "insert" | "update" | "delete";
  path: string;
  value?: unknown;
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
      await this.mutate([{ op: "update", path, value: this.clientOptions.userId ?? this.clientId }]);
      return {
        acquired: true,
        release: () => this.mutate([{ op: "update", path, value: null }])
      };
    }
  };

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

export function createCollectionOperations(
  collection: string,
  id: string,
  op: Operation["op"],
  data?: Record<string, unknown>
): Operation[] {
  if (op === "delete") return [{ op: "delete", path: `${collection}.${id}` }];
  if (op === "insert") return [{ op: "insert", path: `${collection}.${id}`, value: data ?? {} }];

  return Object.entries(data ?? {}).map(([field, value]) => ({
    op: "update",
    path: `${collection}.${id}.${field}`,
    value
  }));
}

export function applyOperations<S extends Record<string, unknown>>(
  state: S,
  operations: Operation[]
): S {
  return operations.reduce((next, operation) => {
    if (operation.op === "delete") return deletePath(next, operation.path) as S;
    return setPath(next, operation.path, operation.value) as S;
  }, clone(state));
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
