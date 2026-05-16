import {
  MemoryEventStore,
  RoomCoordinator,
  type Operation
} from "./coordinator";
import type { ClientMessage, ServerMessage } from "./protocol";

type ClientContext = {
  roomId: string;
  userId: string;
  clientId: string;
  initialVersion: number;
  initialState: Record<string, unknown>;
};

type OculusSocket = Bun.ServerWebSocket<ClientContext>;

const PORT = Number(Bun.env.PORT ?? 3000);
const store = new MemoryEventStore();
const coordinator = new RoomCoordinator(store);
const sockets = new Set<OculusSocket>();

coordinator.defineCollection("nodes", {
  fields: {
    x: { strategy: "lww" },
    y: { strategy: "lww" },
    label: { strategy: "lww" },
    lockedBy: {
      strategy: "custom",
      resolver: (current, incoming, meta) => {
        if (current && current !== meta.userId) return current;
        return incoming;
      }
    }
  }
});

const demoState = {
  nodes: {
    start: { id: "start", x: 120, y: 160, label: "Start", color: "#2563eb" },
    enrich: { id: "enrich", x: 390, y: 110, label: "Enrich lead", color: "#0f766e" },
    notify: { id: "notify", x: 650, y: 230, label: "Notify team", color: "#7c3aed" }
  },
  edges: {
    e1: { id: "e1", source: "start", target: "enrich" },
    e2: { id: "e2", source: "enrich", target: "notify" }
  }
};

Bun.serve<ClientContext>({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(request, server) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const roomMatch = url.pathname.match(/^\/rooms\/([^/]+)$/);
    if (roomMatch && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const roomId = decodeURIComponent(roomMatch[1] ?? "");
      const userId = url.searchParams.get("userId") || `user-${crypto.randomUUID().slice(0, 8)}`;
      const clientId = url.searchParams.get("clientId") || crypto.randomUUID();
      const roomState = await coordinator.loadRoom(
        roomId,
        roomId === "workflow_123" ? demoState : {}
      );

      const upgraded = server.upgrade(request, {
        data: {
          roomId,
          userId,
          clientId,
          initialVersion: roomState.version,
          initialState: roomState.state
        }
      });
      return upgraded ? undefined : json({ error: "upgrade_failed" }, 500);
    }

    if (url.pathname === "/health") {
      return json({ ok: true, service: "oculus-server", runtime: "bun" });
    }

    const eventsMatch = url.pathname.match(/^\/rooms\/([^/]+)\/events$/);
    if (eventsMatch) {
      const roomId = decodeURIComponent(eventsMatch[1] ?? "");
      return json({ events: await coordinator.getEvents(roomId, 0) });
    }

    const replayMatch = url.pathname.match(/^\/rooms\/([^/]+)\/replay\/(\d+)$/);
    if (replayMatch) {
      const roomId = decodeURIComponent(replayMatch[1] ?? "");
      const version = Number(replayMatch[2]);
      return json({
        version,
        state: await coordinator.replayAt(roomId, version)
      });
    }

    return json({ error: "not_found" }, 404);
  },
  websocket: {
    data: {} as ClientContext,
    open(ws) {
      sockets.add(ws);
      coordinator.onClientJoin(ws.data.roomId, ws.data.userId, ws.data.clientId);
      send(ws, {
        type: "room_init",
        version: ws.data.initialVersion,
        state: ws.data.initialState,
        connectedUsers: coordinator.getConnectedUsers(ws.data.roomId)
      });
      broadcastUsers(ws.data.roomId, "joined", ws.data.userId, ws.data.clientId);
    },
    async message(ws, raw) {
      let message: ClientMessage;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (message.type === "mutation") {
        await handleMutation(ws, message);
      }

      if (message.type === "presence") {
        coordinator.updatePresence(ws.data.roomId, ws.data.clientId, message.data);
        broadcast(
          ws.data.roomId,
          {
            type: "presence_broadcast",
            userId: ws.data.userId,
            clientId: ws.data.clientId,
            data: message.data,
            ts: Date.now()
          },
          ws
        );
      }
    },
    async close(ws) {
      sockets.delete(ws);
      await coordinator.onClientLeave(ws.data.roomId, ws.data.clientId);
      broadcastUsers(ws.data.roomId, "left", ws.data.userId, ws.data.clientId);
    }
  }
});

async function handleMutation(
  ws: OculusSocket,
  message: Extract<ClientMessage, { type: "mutation" }>
): Promise<void> {
  const result = await coordinator.applyMutation({
    roomId: ws.data.roomId,
    userId: ws.data.userId,
    clientId: ws.data.clientId,
    operationId: message.operationId,
    baseVersion: message.baseVersion,
    operations: message.operations
  });

  if (result.status === "rejected") {
    send(ws, {
      type: "mutation_ack",
      operationId: message.operationId,
      status: "rejected",
      reason: result.reason
    });
    return;
  }

  send(ws, {
    type: "mutation_ack",
    operationId: message.operationId,
    serverVersion: result.serverVersion,
    transformedOperations: result.transformedOperations,
    status: "accepted"
  });

  broadcast(
    ws.data.roomId,
    {
      type: "mutation_broadcast",
      roomId: ws.data.roomId,
      serverVersion: result.serverVersion,
      userId: ws.data.userId,
      clientId: ws.data.clientId,
      operations: result.transformedOperations as Operation[]
    },
    ws
  );
}

function broadcastUsers(
  roomId: string,
  action: "joined" | "left",
  userId: string,
  clientId: string
): void {
  broadcast(roomId, {
    type: "users_change",
    action,
    userId,
    clientId,
    users: coordinator.getConnectedUsers(roomId)
  });
}

function broadcast(roomId: string, message: ServerMessage, except?: OculusSocket): void {
  for (const socket of sockets) {
    if (socket.data.roomId === roomId && socket !== except) {
      send(socket, message);
    }
  }
}

function send(socket: OculusSocket, message: ServerMessage): void {
  socket.send(JSON.stringify(message));
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json"
    }
  });
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  };
}

console.log(`Oculus coordinator listening on http://0.0.0.0:${PORT}`);
