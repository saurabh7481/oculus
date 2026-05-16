import { Circle, Link2, MousePointer2, Plus, RotateCcw, Trash2, Wifi, WifiOff } from "lucide-react";
import { useMemo, useState } from "react";
import { useOculusRoom } from "@oculus/react";
import { client, userColor, userId, userName } from "./collab";

type WorkflowNode = {
  id: string;
  x: number;
  y: number;
  label: string;
  color?: string;
};

type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
};

type WorkflowState = {
  nodes?: Record<string, WorkflowNode>;
  edges?: Record<string, WorkflowEdge>;
};

const roomId = "workflow_123";

export function App() {
  const {
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
    replayAt
  } = useOculusRoom<WorkflowState>(client, roomId);
  const [dragging, setDragging] = useState<string | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [previewVersion, setPreviewVersion] = useState<number | null>(null);
  const [previewState, setPreviewState] = useState<WorkflowState | null>(null);

  const visibleState = previewState ?? state;
  const nodes = useMemo(() => Object.values(visibleState.nodes ?? {}), [visibleState.nodes]);
  const edges = useMemo(() => Object.values(visibleState.edges ?? {}), [visibleState.edges]);

  async function addNode() {
    const id = `node_${crypto.randomUUID().slice(0, 8)}`;
    await insert("nodes", id, {
      id,
      x: 180 + Math.round(Math.random() * 440),
      y: 130 + Math.round(Math.random() * 260),
      label: "New step",
      color: userColor
    });
  }

  async function moveNode(id: string, x: number, y: number) {
    await update("nodes", id, { x: Math.max(20, x), y: Math.max(80, y) });
    updatePresence({ cursor: { x, y }, selectedNodeId: id, name: userName, color: userColor });
  }

  async function connectNode(target: string) {
    if (!linkMode) return;
    if (!connectFrom) {
      setConnectFrom(target);
      updatePresence({ selectedNodeId: target, name: userName, color: userColor });
      return;
    }
    if (connectFrom !== target) {
      const id = `edge_${crypto.randomUUID().slice(0, 8)}`;
      await insert("edges", id, { id, source: connectFrom, target });
    }
    setConnectFrom(null);
    setLinkMode(false);
  }

  async function showReplay(targetVersion: number) {
    setPreviewVersion(targetVersion);
    setPreviewState(await replayAt(targetVersion));
  }

  function clearReplay() {
    setPreviewVersion(null);
    setPreviewState(null);
  }

  return (
    <main
      className="shell"
      onMouseMove={(event) =>
        updatePresence(
          {
            cursor: { x: event.clientX, y: event.clientY },
            name: userName,
            color: userColor
          },
          { throttle: 35 }
        )
      }
    >
      <section className="canvas">
        <header className="toolbar">
          <div>
            <p className="eyebrow">Oculus SDK demo</p>
            <h1>Collaborative Workflow Builder</h1>
          </div>
          <div className="actions">
            <span className={connected ? "status online" : "status offline"}>
              {connected ? <Wifi size={15} /> : <WifiOff size={15} />}
              {connected ? "Connected" : "Offline queueing"}
            </span>
            <button onClick={addNode}>
              <Plus size={16} />
              Add node
            </button>
            <button
              className={linkMode ? "active" : ""}
              onClick={() => {
                setLinkMode((current) => !current);
                setConnectFrom(null);
              }}
            >
              <Link2 size={16} />
              {linkMode ? (connectFrom ? "Pick target" : "Pick source") : "Link nodes"}
            </button>
          </div>
        </header>

        {previewVersion !== null && (
          <div className="replay-banner">
            <RotateCcw size={15} />
            Viewing replay at v{previewVersion}
            <button onClick={clearReplay}>Return live</button>
          </div>
        )}

        <div className="board">
          <svg className="edges">
            {edges.map((edge) => {
              const source = visibleState.nodes?.[edge.source];
              const target = visibleState.nodes?.[edge.target];
              if (!source || !target) return null;
              return (
                <line
                  key={edge.id}
                  x1={source.x + 76}
                  y1={source.y + 29}
                  x2={target.x + 76}
                  y2={target.y + 29}
                />
              );
            })}
          </svg>

          {nodes.map((node) => (
            <article
              key={node.id}
              className={`node ${connectFrom === node.id ? "selected" : ""}`}
              style={{ left: node.x, top: node.y, borderColor: node.color ?? "#2563eb" }}
              onPointerDown={(event) => {
                if (previewState) return;
                setDragging(node.id);
                (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
              }}
              onPointerUp={(event) => {
                if (!dragging || previewState) return;
                setDragging(null);
                const board = event.currentTarget.parentElement?.getBoundingClientRect();
                if (board) void moveNode(node.id, event.clientX - board.left - 76, event.clientY - board.top - 28);
              }}
              onClick={() => !previewState && linkMode && void connectNode(node.id)}
            >
              <span style={{ background: node.color ?? "#2563eb" }} />
              <input
                value={node.label}
                disabled={Boolean(previewState)}
                onChange={(event) => void update("nodes", node.id, { label: event.target.value })}
                onFocus={() =>
                  updatePresence({
                    selectedNodeId: node.id,
                    editing: `nodes.${node.id}.label`,
                    name: userName,
                    color: userColor
                  })
                }
              />
              <button aria-label={`Delete ${node.label}`} onClick={() => void remove("nodes", node.id)}>
                <Trash2 size={14} />
              </button>
            </article>
          ))}

          {Object.entries(cursors).map(([clientId, cursor]) => (
            <div
              key={clientId}
              className="cursor"
              style={{ left: cursor.x, top: cursor.y, color: cursor.color ?? "#2563eb" }}
            >
              <MousePointer2 size={18} fill="currentColor" />
              <span>{cursor.name ?? "Collaborator"}</span>
            </div>
          ))}
        </div>
      </section>

      <aside className="sidebar">
        <section>
          <p className="eyebrow">Room</p>
          <h2>{roomId}</h2>
          <div className="metric">
            <span>Version</span>
            <strong>{version}</strong>
          </div>
          <div className="metric">
            <span>Users</span>
            <strong>{Math.max(users.length, 1)}</strong>
          </div>
        </section>

        <section>
          <p className="eyebrow">Collaborators</p>
          <ul className="people">
            <li>
              <Circle size={10} fill={userColor} color={userColor} />
              {userName} <span>you</span>
            </li>
            {users
              .filter((user) => user.userId !== userId)
              .map((user) => (
                <li key={user.clientId}>
                  <Circle size={10} fill="#0f766e" color="#0f766e" />
                  {user.userId}
                </li>
              ))}
          </ul>
        </section>

        <section className="history">
          <p className="eyebrow">Event history</p>
          {events.length === 0 ? (
            <p className="empty">Move a node or edit a label to create the first event.</p>
          ) : (
            events
              .slice()
              .reverse()
              .map((event) => (
                <button key={event.operationId} onClick={() => void showReplay(event.version)}>
                  <span>v{event.version}</span>
                  <strong>{event.operations.map((op) => op.path).join(", ")}</strong>
                  <small>{event.userId}</small>
                </button>
              ))
          )}
        </section>
      </aside>
    </main>
  );
}
