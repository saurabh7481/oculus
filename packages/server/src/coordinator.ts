import {
  applyCrdtTextOperation,
  encodeCrdtTextState
} from "./crdt";
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

export type PermissionOperation = Operation["op"] | "*";

export type PermissionRule = {
  path: string;
  operations?: PermissionOperation[];
  roles: string[];
};

export type PermissionContext = {
  userId: string;
  clientId: string;
  roles: string[];
};

export type MutationMetadata = {
  label?: string;
  kind?: string;
  targetIds?: string[];
  inverseOperations?: Operation[];
  undoOf?: string;
  redoOf?: string;
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

export type ReplayDiffChange = {
  path: string;
  before: unknown;
  after: unknown;
  kind: "added" | "removed" | "changed";
};

export type ReplayDiff = {
  roomId: string;
  fromVersion: number;
  toVersion: number;
  fromState: Record<string, unknown>;
  toState: Record<string, unknown>;
  events: RoomEvent[];
  changedPaths: string[];
  changes: ReplayDiffChange[];
};

export type RoomCoordinatorOptions = {
  snapshotInterval?: number;
  snapshotRetention?: number;
  idleRoomTtlMs?: number;
};

export type WorkflowEdgeValidatorConfig = {
  edgeCollection: string;
  nodeCollection: string;
  sourceNodeField?: string;
  targetNodeField?: string;
  sourcePortField?: string;
  targetPortField?: string;
};

export type RoomDefinition = {
  collections?: Record<string, CollectionConfig>;
  permissions?: PermissionRule[];
  edgeValidators?: WorkflowEdgeValidatorConfig[];
  schema?: z.ZodType<Record<string, unknown>>;
};

type RoomCacheEntry = {
  version: number;
  state: Record<string, unknown>;
  initialState: Record<string, unknown>;
  crdtTextStates: Map<string, number[]>;
  connectedClients: Map<string, { userId: string; presence: Record<string, unknown> }>;
  lastAccess: number;
};

export interface EventStore {
  loadInitialState(roomId: string): Promise<Record<string, unknown> | undefined>;
  saveInitialState(roomId: string, state: Record<string, unknown>): Promise<void>;
  appendEvent(event: RoomEvent): Promise<void>;
  getEvents(roomId: string, afterVersion?: number): Promise<RoomEvent[]>;
  getLatestSnapshot(
    roomId: string,
    atOrBeforeVersion?: number
  ): Promise<{ version: number; state: Record<string, unknown> } | undefined>;
  saveSnapshot(roomId: string, version: number, state: Record<string, unknown>): Promise<void>;
  getCrdtTextStates(roomId: string, atOrBeforeVersion?: number): Promise<Map<string, number[]>>;
  saveCrdtTextStates(roomId: string, version: number, states: Map<string, number[]>): Promise<void>;
  pruneSnapshots(roomId: string, keepLatest: number): Promise<void>;
}

export class MemoryEventStore implements EventStore {
  private initialStates = new Map<string, Record<string, unknown>>();
  private events = new Map<string, RoomEvent[]>();
  private snapshots = new Map<string, Array<{ version: number; state: Record<string, unknown> }>>();
  private crdtTextStates = new Map<string, Array<{ version: number; states: Map<string, number[]> }>>();

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
    events.push({ ...event, operations: clone(event.operations), metadata: clone(event.metadata) });
    this.events.set(event.roomId, events);
  }

  async getEvents(roomId: string, afterVersion = 0): Promise<RoomEvent[]> {
    return (this.events.get(roomId) ?? [])
      .filter((event) => event.version > afterVersion)
      .map((event) => ({ ...event, operations: clone(event.operations), metadata: clone(event.metadata) }));
  }

  async getLatestSnapshot(
    roomId: string,
    atOrBeforeVersion = Number.POSITIVE_INFINITY
  ): Promise<{ version: number; state: Record<string, unknown> } | undefined> {
    const snapshot = (this.snapshots.get(roomId) ?? [])
      .filter((candidate) => candidate.version <= atOrBeforeVersion)
      .sort((a, b) => b.version - a.version)[0];
    return snapshot ? { version: snapshot.version, state: clone(snapshot.state) } : undefined;
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

  async getCrdtTextStates(
    roomId: string,
    atOrBeforeVersion = Number.POSITIVE_INFINITY
  ): Promise<Map<string, number[]>> {
    const snapshot = (this.crdtTextStates.get(roomId) ?? [])
      .filter((candidate) => candidate.version <= atOrBeforeVersion)
      .sort((a, b) => b.version - a.version)[0];
    return snapshot ? cloneCrdtTextStates(snapshot.states) : new Map();
  }

  async saveCrdtTextStates(roomId: string, version: number, states: Map<string, number[]>): Promise<void> {
    const snapshots = this.crdtTextStates.get(roomId) ?? [];
    snapshots.push({ version, states: cloneCrdtTextStates(states) });
    this.crdtTextStates.set(roomId, snapshots);
  }

  async pruneSnapshots(roomId: string, keepLatest: number): Promise<void> {
    const keep = normalizeSnapshotRetention(keepLatest);
    const retainedVersions = (this.snapshots.get(roomId) ?? [])
      .map((snapshot) => snapshot.version)
      .sort((a, b) => b - a)
      .slice(0, keep);
    const retained = new Set(retainedVersions);

    this.snapshots.set(
      roomId,
      (this.snapshots.get(roomId) ?? []).filter((snapshot) => retained.has(snapshot.version))
    );
    this.crdtTextStates.set(
      roomId,
      (this.crdtTextStates.get(roomId) ?? []).filter((snapshot) => retained.has(snapshot.version))
    );
  }
}

export class RoomCoordinator {
  private rooms = new Map<string, RoomCacheEntry>();
  private collectionConfigs = new Map<string, CollectionConfig>();
  private permissionRules = new Map<string, PermissionRule[]>();
  private roomDefinitions = new Map<string, RoomDefinition>();
  private mutationQueues = new Map<string, Promise<void>>();
  private readonly snapshotInterval: number;
  private readonly snapshotRetention?: number;
  private readonly idleRoomTtlMs?: number;

  constructor(
    private readonly store: EventStore = new MemoryEventStore(),
    options: RoomCoordinatorOptions = {}
  ) {
    this.snapshotInterval = normalizePositiveInteger(options.snapshotInterval, 100);
    this.snapshotRetention = options.snapshotRetention;
    this.idleRoomTtlMs = options.idleRoomTtlMs;
  }

  defineCollection(name: string, config: CollectionConfig): void {
    this.collectionConfigs.set(name, config);
  }

  defineRoom(roomId: string, definition: RoomDefinition): void {
    this.roomDefinitions.set(roomId, copyRoomDefinition(definition));
  }

  definePermissions(rules: PermissionRule[]): void;
  definePermissions(roomId: string, rules: PermissionRule[]): void;
  definePermissions(roomIdOrRules: string | PermissionRule[], maybeRules?: PermissionRule[]): void {
    const roomId = typeof roomIdOrRules === "string" ? roomIdOrRules : "*";
    const rules = typeof roomIdOrRules === "string" ? maybeRules ?? [] : roomIdOrRules;
    this.permissionRules.set(roomId, rules.map((rule) => ({
      path: rule.path,
      operations: rule.operations ? [...rule.operations] : undefined,
      roles: [...rule.roles]
    })));
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

    const snapshot = await this.store.getLatestSnapshot(roomId);
    let version = snapshot?.version ?? 0;
    let state = snapshot ? clone(snapshot.state) : clone(initialState);
    const crdtTextStates = await this.store.getCrdtTextStates(roomId, version);
    for (const event of await this.store.getEvents(roomId, version)) {
      state = this.applyOperations(state, event.operations, {
        roomId,
        currentVersion: version,
        incomingVersion: event.version - 1,
        userId: event.userId,
        timestamp: event.timestamp
      }, crdtTextStates);
      version = event.version;
    }

    this.rooms.set(roomId, {
      version,
      state,
      initialState,
      crdtTextStates,
      connectedClients: new Map(),
      lastAccess: Date.now()
    });

    return { version, state: clone(state), connectedUsers: [] };
  }

  async applyMutation(params: {
    roomId: string;
    userId: string;
    roles?: string[];
    clientId: string;
    operationId: string;
    baseVersion: number;
    operations: Operation[];
    metadata?: MutationMetadata;
  }): Promise<
    | {
        status: "accepted";
        serverVersion: number;
        transformedOperations: Operation[];
        state: Record<string, unknown>;
      }
    | { status: "rejected"; reason: string }
  > {
    return this.withRoomMutationQueue(params.roomId, () => this.applyMutationUnlocked(params));
  }

  private async applyMutationUnlocked(params: {
    roomId: string;
    userId: string;
    roles?: string[];
    clientId: string;
    operationId: string;
    baseVersion: number;
    operations: Operation[];
    metadata?: MutationMetadata;
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

    const permissionDeniedPath = this.getPermissionDeniedPath(params.roomId, params.operations, {
      userId: params.userId,
      clientId: params.clientId,
      roles: params.roles ?? []
    });
    if (permissionDeniedPath) {
      return { status: "rejected", reason: `permission_denied:${permissionDeniedPath}` };
    }

    const validationError = this.getValidationError(params.roomId, room.state, params.operations);
    if (validationError) {
      return { status: "rejected", reason: `validation_failed:${validationError}` };
    }

    const transformedOperations = this.transformOperations(
      params.operations,
      params.baseVersion,
      room.version
    );
    const serverVersion = room.version + 1;
    const timestamp = Date.now();

    const nextCrdtTextStates = cloneCrdtTextStates(room.crdtTextStates);
    const nextState = this.applyOperations(room.state, transformedOperations, {
      roomId: params.roomId,
      currentVersion: room.version,
      incomingVersion: params.baseVersion,
      userId: params.userId,
      timestamp
    }, nextCrdtTextStates);
    const schemaValidationError = this.getSchemaValidationError(params.roomId, nextState);
    if (schemaValidationError) {
      return { status: "rejected", reason: "schema_validation_failed" };
    }

    try {
      await this.store.appendEvent({
        roomId: params.roomId,
        userId: params.userId,
        clientId: params.clientId,
        operationId: params.operationId,
        version: serverVersion,
        operations: transformedOperations,
        timestamp,
        metadata: clone(params.metadata)
      });
    } catch {
      return { status: "rejected", reason: "event_persist_failed" };
    }

    room.version = serverVersion;
    room.state = nextState;
    room.crdtTextStates = nextCrdtTextStates;
    room.lastAccess = timestamp;

    if (serverVersion % this.snapshotInterval === 0) {
      void this.saveRoomSnapshot(params.roomId, serverVersion, nextState, nextCrdtTextStates);
    }

    return {
      status: "accepted",
      serverVersion,
      transformedOperations,
      state: clone(nextState)
    };
  }

  private async withRoomMutationQueue<T>(roomId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueues.get(roomId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.catch(() => undefined).then(() => current);
    this.mutationQueues.set(roomId, queued);

    await previous.catch(() => undefined);

    try {
      return await task();
    } finally {
      release();
      if (this.mutationQueues.get(roomId) === queued) {
        this.mutationQueues.delete(roomId);
      }
    }
  }

  getRoomState(roomId: string): Record<string, unknown> | undefined {
    const room = this.rooms.get(roomId);
    return room ? clone(room.state) : undefined;
  }

  getRoomVersion(roomId: string): number {
    return this.rooms.get(roomId)?.version ?? 0;
  }

  getLoadedRoomIds(): string[] {
    return [...this.rooms.keys()].sort();
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
    room.lastAccess = Date.now();
    if (room.connectedClients.size === 0) {
      await this.saveRoomSnapshot(roomId, room.version, room.state, room.crdtTextStates);
    }
  }

  async compactRoom(roomId: string): Promise<{ version: number; snapshotSaved: boolean } | undefined> {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;
    await this.saveRoomSnapshot(roomId, room.version, room.state, room.crdtTextStates);
    room.lastAccess = Date.now();
    return { version: room.version, snapshotSaved: true };
  }

  async collectIdleRooms(now = Date.now()): Promise<string[]> {
    if (this.idleRoomTtlMs === undefined) return [];

    const evicted: string[] = [];
    for (const [roomId, room] of this.rooms.entries()) {
      if (room.connectedClients.size > 0) continue;
      if (now - room.lastAccess < this.idleRoomTtlMs) continue;

      await this.saveRoomSnapshot(roomId, room.version, room.state, room.crdtTextStates);
      this.rooms.delete(roomId);
      evicted.push(roomId);
    }

    return evicted.sort();
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
    const snapshot = await this.store.getLatestSnapshot(roomId, version);
    let state = snapshot ? clone(snapshot.state) : clone(initialState);
    const crdtTextStates = await this.store.getCrdtTextStates(roomId, snapshot?.version ?? 0);

    for (const event of await this.store.getEvents(roomId, snapshot?.version ?? 0)) {
      if (event.version > version) break;
      state = this.applyOperations(state, event.operations, {
        roomId,
        currentVersion: event.version - 1,
        incomingVersion: event.version - 1,
        userId: event.userId,
        timestamp: event.timestamp
      }, crdtTextStates);
    }

    return state;
  }

  async diffVersions(roomId: string, fromVersion: number, toVersion: number): Promise<ReplayDiff> {
    const lowerVersion = Math.min(fromVersion, toVersion);
    const upperVersion = Math.max(fromVersion, toVersion);
    const fromState = await this.replayAt(roomId, lowerVersion);
    const toState = await this.replayAt(roomId, upperVersion);
    const events = (await this.store.getEvents(roomId, lowerVersion))
      .filter((event) => event.version <= upperVersion);
    const changes = diffStates(fromState, toState);

    return {
      roomId,
      fromVersion: lowerVersion,
      toVersion: upperVersion,
      fromState,
      toState,
      events,
      changedPaths: changes.map((change) => change.path),
      changes
    };
  }

  private transformOperations(
    operations: Operation[],
    _baseVersion: number,
    _currentVersion: number
  ): Operation[] {
    return clone(operations);
  }

  private getPermissionDeniedPath(
    roomId: string,
    operations: Operation[],
    context: PermissionContext
  ): string | undefined {
    const rules = this.getPermissionRules(roomId);
    if (rules.length === 0) return undefined;

    for (const operation of operations) {
      if (!this.isOperationAllowed(operation, context, rules)) {
        return operation.path;
      }
    }

    return undefined;
  }

  private getPermissionRules(roomId: string): PermissionRule[] {
    return this.permissionRules.get(roomId)
      ?? this.roomDefinitions.get(roomId)?.permissions
      ?? this.permissionRules.get("*")
      ?? [];
  }

  private isOperationAllowed(operation: Operation, context: PermissionContext, rules: PermissionRule[]): boolean {
    return rules.some((rule) => {
      if (!matchesPathPattern(rule.path, operation.path)) return false;
      if (rule.operations && !rule.operations.includes("*") && !rule.operations.includes(operation.op)) return false;
      return rule.roles.includes("*") || context.roles.some((role) => rule.roles.includes(role));
    });
  }

  private applyOperations(
    state: Record<string, unknown>,
    operations: Operation[],
    meta: ConflictMeta,
    crdtTextStates = new Map<string, number[]>()
  ): Record<string, unknown> {
    return operations.reduce(
      (nextState, operation) => this.applyOperation(nextState, operation, meta, crdtTextStates),
      clone(state)
    );
  }

  private applyOperation(
    state: Record<string, unknown>,
    operation: Operation,
    meta: ConflictMeta,
    crdtTextStates: Map<string, number[]>
  ): Record<string, unknown> {
    if (operation.op !== "delete" && operation.op !== "tombstone-delete" && hasTombstoneAncestor(state, operation.path)) {
      return state;
    }

    if (operation.op === "delete") {
      return deletePath(state, operation.path);
    }

    if (operation.op === "tombstone-delete") {
      return setPath(state, operation.path, applyTombstoneDelete(getPath(state, operation.path), operation.value));
    }

    if (operation.op === "text") {
      const strategy = this.getFieldStrategy(meta.roomId, operation.path);
      if (strategy?.strategy === "crdt-text") {
        const result = applyCrdtTextOperation(
          getPath(state, operation.path),
          operation.value,
          crdtTextStates.get(operation.path)
        );
        crdtTextStates.set(operation.path, result.encodedState);
        return setPath(state, operation.path, result.text);
      }

      return setPath(
        state,
        operation.path,
        applyTextOperation(getPath(state, operation.path), operation.value)
      );
    }

    if (operation.op === "list-move") {
      return setPath(
        state,
        operation.path,
        applyListMoveOperation(getPath(state, operation.path), operation.value)
      );
    }

    if (operation.op === "lock") {
      return setPath(state, operation.path, operation.value.owner);
    }

    if (operation.op === "tree-move") {
      return setPath(
        state,
        operation.path,
        applyTreeMoveOperation(getPath(state, operation.path), operation.value)
      );
    }

    const strategy = this.getFieldStrategy(meta.roomId, operation.path);
    if (strategy?.strategy === "crdt-text") {
      crdtTextStates.set(operation.path, encodeCrdtTextState(operation.value));
    }

    if (strategy?.strategy === "custom") {
      const current = getPath(state, operation.path);
      return setPath(state, operation.path, strategy.resolver(current, operation.value, meta));
    }

    return setPath(state, operation.path, operation.value);
  }

  private getFieldStrategy(roomId: string, path: string): FieldStrategy | undefined {
    const [collection, , field] = path.split(".");
    if (!collection || !field) return undefined;
    return this.roomDefinitions.get(roomId)?.collections?.[collection]?.fields?.[field]
      ?? this.collectionConfigs.get(collection)?.fields?.[field];
  }

  private getValidationError(
    roomId: string,
    state: Record<string, unknown>,
    operations: Operation[]
  ): string | undefined {
    const definition = this.roomDefinitions.get(roomId);
    if (!definition?.edgeValidators?.length) return undefined;
    const edgeCollections = new Set(definition.edgeValidators.map((validator) => validator.edgeCollection));
    const seedOperations = operations.filter((operation) => !isRootCollectionWrite(operation, edgeCollections));
    const validationState = seedOperations.length > 0
      ? this.applyOperations(state, seedOperations, {
        roomId,
        currentVersion: 0,
        incomingVersion: 0,
        userId: "validator",
        timestamp: Date.now()
      }, new Map())
      : state;

    for (const operation of operations) {
      for (const validator of definition.edgeValidators) {
        const error = validateWorkflowEdgeOperation(validationState, operation, validator);
        if (error) return error;
      }
    }

    return undefined;
  }

  private getSchemaValidationError(roomId: string, state: Record<string, unknown>): string | undefined {
    const schema = this.roomDefinitions.get(roomId)?.schema;
    if (!schema) return undefined;
    const result = schema.safeParse(state);
    return result.success ? undefined : result.error.message;
  }

  private async saveRoomSnapshot(
    roomId: string,
    version: number,
    state: Record<string, unknown>,
    crdtTextStates: Map<string, number[]>
  ): Promise<void> {
    await this.store.saveSnapshot(roomId, version, state);
    await this.store.saveCrdtTextStates(roomId, version, crdtTextStates);
    if (this.snapshotRetention !== undefined) {
      await this.store.pruneSnapshots(roomId, this.snapshotRetention);
    }
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

function applyListMoveOperation(current: unknown, value: ListMoveOperationValue): unknown[] {
  if (!Array.isArray(current) || current.length === 0) return Array.isArray(current) ? [...current] : [];
  const next = [...current];
  const from = clampInteger(value.from, 0, next.length - 1);
  const [item] = next.splice(from, 1);
  const to = clampInteger(value.to, 0, next.length);
  next.splice(to, 0, item);
  return next;
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

function matchesPathPattern(pattern: string, path: string): boolean {
  const patternParts = pattern.split(".");
  const pathParts = path.split(".");
  if (patternParts.length !== pathParts.length) return false;

  return patternParts.every((part, index) => part === "*" || part === pathParts[index]);
}

function validateWorkflowEdgeOperation(
  state: Record<string, unknown>,
  operation: Operation,
  config: WorkflowEdgeValidatorConfig
): string | undefined {
  if (operation.op !== "set" && operation.op !== "insert" && operation.op !== "update") return undefined;

  const [collection, edgeId] = operation.path.split(".");
  if (collection !== config.edgeCollection || !edgeId || operation.path.split(".").length !== 2) {
    return undefined;
  }
  if (!isRecord(operation.value)) return `${operation.path}.invalid_edge`;

  const sourceNodeField = config.sourceNodeField ?? "sourceNodeId";
  const targetNodeField = config.targetNodeField ?? "targetNodeId";
  const sourcePortField = config.sourcePortField ?? "sourcePortId";
  const targetPortField = config.targetPortField ?? "targetPortId";
  const sourceNodeId = operation.value[sourceNodeField];
  const targetNodeId = operation.value[targetNodeField];
  if (typeof sourceNodeId !== "string") return `${operation.path}.source_node_missing`;
  if (typeof targetNodeId !== "string") return `${operation.path}.target_node_missing`;

  const sourceNode = getPath(state, `${config.nodeCollection}.${sourceNodeId}`);
  const targetNode = getPath(state, `${config.nodeCollection}.${targetNodeId}`);
  if (!isRecord(sourceNode)) return `${operation.path}.source_node_missing`;
  if (!isRecord(targetNode)) return `${operation.path}.target_node_missing`;

  const sourcePortId = operation.value[sourcePortField];
  if (typeof sourcePortId === "string" && !hasPort(sourceNode, "outputs", sourcePortId)) {
    return `${operation.path}.source_port_missing`;
  }

  const targetPortId = operation.value[targetPortField];
  if (typeof targetPortId === "string" && !hasPort(targetNode, "inputs", targetPortId)) {
    return `${operation.path}.target_port_missing`;
  }

  return undefined;
}

function isRootCollectionWrite(operation: Operation, collections: Set<string>): boolean {
  if (operation.op !== "set" && operation.op !== "insert" && operation.op !== "update") return false;
  const [collection, id, field] = operation.path.split(".");
  return Boolean(collection && id && !field && collections.has(collection));
}

function copyRoomDefinition(definition: RoomDefinition): RoomDefinition {
  return {
    collections: Object.fromEntries(
      Object.entries(definition.collections ?? {}).map(([name, config]) => [name, copyCollectionConfig(config)])
    ),
    permissions: definition.permissions?.map((rule) => ({
      path: rule.path,
      operations: rule.operations ? [...rule.operations] : undefined,
      roles: [...rule.roles]
    })),
    edgeValidators: definition.edgeValidators?.map((validator) => ({ ...validator })),
    schema: definition.schema
  };
}

function copyCollectionConfig(config: CollectionConfig): CollectionConfig {
  return {
    fields: Object.fromEntries(
      Object.entries(config.fields ?? {}).map(([field, strategy]) => [field, { ...strategy }])
    )
  };
}

function hasPort(node: Record<string, unknown>, direction: "inputs" | "outputs", portId: string): boolean {
  const ports = node.ports;
  if (!isRecord(ports)) return false;
  const candidates = ports[direction];
  return Array.isArray(candidates) && candidates.some((port) => isRecord(port) && port.id === portId);
}

function diffStates(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  path: string[] = []
): ReplayDiffChange[] {
  if (Object.is(before, after)) return [];

  if (!isRecord(before) || !isRecord(after)) {
    return [{
      path: path.join("."),
      before,
      after,
      kind: before === undefined ? "added" : after === undefined ? "removed" : "changed"
    }];
  }

  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return keys.flatMap((key) => {
    const nextPath = [...path, key];
    const beforeValue = before[key];
    const afterValue = after[key];

    if (Object.is(beforeValue, afterValue)) return [];
    if (beforeValue === undefined || afterValue === undefined) {
      return [{
        path: nextPath.join("."),
        before: beforeValue,
        after: afterValue,
        kind: beforeValue === undefined ? "added" : "removed"
      }];
    }
    if (isRecord(beforeValue) && isRecord(afterValue)) {
      return diffStates(beforeValue, afterValue, nextPath);
    }
    return [{
      path: nextPath.join("."),
      before: beforeValue,
      after: afterValue,
      kind: "changed"
    }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function cloneCrdtTextStates(states: Map<string, number[]>): Map<string, number[]> {
  return new Map([...states.entries()].map(([path, state]) => [path, [...state]]));
}

function normalizeSnapshotRetention(keepLatest: number): number {
  return Number.isFinite(keepLatest) ? Math.max(1, Math.trunc(keepLatest)) : 1;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.trunc(value as number)) : fallback;
}
