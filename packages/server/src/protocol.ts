import type { Operation } from "./coordinator";

export type ClientMessage =
  | {
      type: "mutation";
      operationId: string;
      baseVersion: number;
      operations: Operation[];
    }
  | {
      type: "presence";
      data: Record<string, unknown>;
    };

export type ServerMessage =
  | {
      type: "room_init";
      version: number;
      state: Record<string, unknown>;
      connectedUsers: Array<{
        userId: string;
        clientId: string;
        presence: Record<string, unknown>;
      }>;
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
      roomId: string;
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
      action: "joined" | "left";
      userId: string;
      clientId: string;
      users: Array<{
        userId: string;
        clientId: string;
        presence: Record<string, unknown>;
      }>;
    };
