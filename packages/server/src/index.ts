import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
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
};

const PORT = Number(process.env.PORT ?? 3000);
const store = new MemoryEventStore();
const coordinator = new RoomCoordinator(store);
const sockets = new Map<WebSocket, ClientContext>();

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

const server = createServer(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/health") {
    sendJson(res, 200, { ok: true, service: "oculus-server" });
    return;
  }

  const eventsMatch = url.pathname.match(/^\/rooms\/([^/]+)\/events$/);
  if (eventsMatch) {
    const roomId = decodeURIComponent(eventsMatch[1] ?? "");
    sendJson(res, 200, { events: await coordinator.getEvents(roomId, 0) });
    return;
  }

  const replayMatch = url.pathname.match(/^\/rooms\/([^/]+)\/replay\/(\d+)$/);
  if (replayMatch) {
    const roomId = decodeURIComponent(replayMatch[1] ?? "");
    const version = Number(replayMatch[2]);
    sendJson(res, 200, {
      version,
      state: await coordinator.replayAt(roomId, version)
    });
    return;
  }

  sendJson(res, 404, { error: "not_found" });
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const match = url.pathname.match(/^\/rooms\/([^/]+)$/);

  if (!match) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req, decodeURIComponent(match[1] ?? ""));
  });
});

wss.on("connection", async (ws: WebSocket, req: IncomingMessage, roomId: string) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const userId = url.searchParams.get("userId") || `user-${randomUUID().slice(0, 8)}`;
  const clientId = url.searchParams.get("clientId") || randomUUID();

  const roomState = await coordinator.loadRoom(roomId, roomId === "workflow_123" ? demoState : {});
  coordinator.onClientJoin(roomId, userId, clientId);
  sockets.set(ws, { roomId, userId, clientId });

  send(ws, {
    type: "room_init",
    version: roomState.version,
    state: roomState.state,
    connectedUsers: coordinator.getConnectedUsers(roomId)
  });
  broadcastUsers(roomId, "joined", userId, clientId);

  ws.on("message", async (raw) => {
    const context = sockets.get(ws);
    if (!context) return;

    let message: ClientMessage;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (message.type === "mutation") {
      await handleMutation(ws, context, message);
    }

    if (message.type === "presence") {
      coordinator.updatePresence(context.roomId, context.clientId, message.data);
      broadcast(context.roomId, {
        type: "presence_broadcast",
        userId: context.userId,
        clientId: context.clientId,
        data: message.data,
        ts: Date.now()
      }, ws);
    }
  });

  ws.on("close", async () => {
    sockets.delete(ws);
    await coordinator.onClientLeave(roomId, clientId);
    broadcastUsers(roomId, "left", userId, clientId);
  });
});

async function handleMutation(
  ws: WebSocket,
  context: ClientContext,
  message: Extract<ClientMessage, { type: "mutation" }>
): Promise<void> {
  const result = await coordinator.applyMutation({
    roomId: context.roomId,
    userId: context.userId,
    clientId: context.clientId,
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

  broadcast(context.roomId, {
    type: "mutation_broadcast",
    roomId: context.roomId,
    serverVersion: result.serverVersion,
    userId: context.userId,
    clientId: context.clientId,
    operations: result.transformedOperations as Operation[]
  }, ws);
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

function broadcast(roomId: string, message: ServerMessage, except?: WebSocket): void {
  for (const [socket, context] of sockets.entries()) {
    if (context.roomId === roomId && socket !== except && socket.readyState === socket.OPEN) {
      send(socket, message);
    }
  }
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Oculus coordinator listening on http://0.0.0.0:${PORT}`);
});
