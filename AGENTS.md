# Oculus Agent Instructions

## SDK Documentation Rule

Whenever code changes alter the public SDK surface, update [docs/SDK.md](docs/SDK.md) in the same change.

This includes changes to:

- `packages/sdk/src/index.ts`
- `packages/svelte/src/index.ts`
- exported types such as `Operation`, `RoomEvent`, `PresenceUser`, or room/store result types
- connection options, room options, mutation helpers, presence helpers, replay/event APIs, or Svelte store APIs

The SDK docs should explain what each public function/type does, show the expected call shape, and mention important behavior such as optimistic updates, rollback, throttling, offline queueing, and replay.

## SDK Developer Experience Rule

Public SDK changes should keep the default developer experience intuitive, domain-neutral, and easy to teach.

- Prefer simple app-language methods such as `collection`, `create`, `change`, `remove`, `text`, `list`, `tree`, `move`, and `presence` for the main path.
- Do not require app developers to know raw dot paths, operation internals, CRDT mechanics, Yjs update formats, or server conflict strategies for common workflows.
- Keep low-level operations, raw paths, and native CRDT/Yjs APIs available as advanced escape hatches, but document them separately from the beginner path.
- Preserve type safety where practical. For example, collection text helpers should guide users toward string fields instead of accepting any arbitrary field name.
- When adding or changing SDK APIs, include at least one clear, intuitive docs example that shows the preferred usage before any advanced API details.
- Avoid naming public helpers after engine implementation details unless the helper is explicitly part of the advanced engine API.

Before finishing SDK-related work, run:

```bash
bun run test
bun run build
bun run typecheck
```
