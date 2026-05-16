import type { Sql } from "postgres";
import type { EventStore, RoomEvent } from "./coordinator";

type EventRow = {
  room_id: string;
  user_id: string;
  client_id: string;
  operation_id: string;
  version: number;
  operations: RoomEvent["operations"];
  timestamp_ms: number | string;
};

type SnapshotRow = {
  version: number;
  state: Record<string, unknown>;
};

type RoomRow = {
  initial_state: Record<string, unknown>;
};

export async function migratePostgresEventStore(sql: Sql): Promise<void> {
  await sql`
    create table if not exists rooms (
      id text primary key,
      initial_state jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;

  await sql`
    create table if not exists room_events (
      room_id text not null references rooms(id) on delete cascade,
      version integer not null,
      user_id text not null,
      client_id text not null,
      operation_id text not null,
      operations jsonb not null,
      timestamp_ms bigint not null,
      created_at timestamptz not null default now(),
      primary key (room_id, version),
      unique (room_id, operation_id)
    )
  `;

  await sql`
    create table if not exists room_snapshots (
      room_id text not null references rooms(id) on delete cascade,
      version integer not null,
      state jsonb not null,
      created_at timestamptz not null default now(),
      primary key (room_id, version)
    )
  `;

  await sql`
    create index if not exists room_events_room_version_idx
    on room_events (room_id, version)
  `;

  await sql`
    create index if not exists room_snapshots_room_version_desc_idx
    on room_snapshots (room_id, version desc)
  `;
}

export class PostgresEventStore implements EventStore {
  constructor(private readonly sql: Sql) {}

  async loadInitialState(roomId: string): Promise<Record<string, unknown> | undefined> {
    const rows = await this.sql<RoomRow[]>`
      select initial_state
      from rooms
      where id = ${roomId}
      limit 1
    `;
    return rows[0] ? clone(rows[0].initial_state) : undefined;
  }

  async saveInitialState(roomId: string, state: Record<string, unknown>): Promise<void> {
    await this.sql`
      insert into rooms (id, initial_state)
      values (${roomId}, ${this.json(state)})
      on conflict (id) do nothing
    `;
  }

  async appendEvent(event: RoomEvent): Promise<void> {
    await this.sql`
      insert into room_events (
        room_id,
        version,
        user_id,
        client_id,
        operation_id,
        operations,
        timestamp_ms
      )
      values (
        ${event.roomId},
        ${event.version},
        ${event.userId},
        ${event.clientId},
        ${event.operationId},
        ${this.json(event.operations)},
        ${event.timestamp}
      )
    `;
  }

  async getEvents(roomId: string, afterVersion = 0): Promise<RoomEvent[]> {
    const rows = await this.sql<EventRow[]>`
      select room_id, user_id, client_id, operation_id, version, operations, timestamp_ms
      from room_events
      where room_id = ${roomId}
        and version > ${afterVersion}
      order by version asc
    `;

    return rows.map((row) => ({
      roomId: row.room_id,
      userId: row.user_id,
      clientId: row.client_id,
      operationId: row.operation_id,
      version: row.version,
      operations: clone(row.operations),
      timestamp: Number(row.timestamp_ms)
    }));
  }

  async getLatestSnapshot(
    roomId: string,
    atOrBeforeVersion = Number.POSITIVE_INFINITY
  ): Promise<{ version: number; state: Record<string, unknown> } | undefined> {
    const rows = await this.sql<SnapshotRow[]>`
      select version, state
      from room_snapshots
      where room_id = ${roomId}
        and version <= ${finiteVersion(atOrBeforeVersion)}
      order by version desc
      limit 1
    `;
    const snapshot = rows[0];
    return snapshot ? { version: snapshot.version, state: clone(snapshot.state) } : undefined;
  }

  async saveSnapshot(
    roomId: string,
    version: number,
    state: Record<string, unknown>
  ): Promise<void> {
    await this.sql`
      insert into room_snapshots (room_id, version, state)
      values (${roomId}, ${version}, ${this.json(state)})
      on conflict (room_id, version)
      do update set state = excluded.state, created_at = now()
    `;
  }

  private json(value: unknown): ReturnType<Sql["json"]> {
    return this.sql.json(value as Parameters<Sql["json"]>[0]);
  }
}

function finiteVersion(version: number): number {
  return Number.isFinite(version) ? version : 2_147_483_647;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
