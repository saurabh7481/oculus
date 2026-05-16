# Oculus Agent Instructions

## SDK Documentation Rule

Whenever code changes alter the public SDK surface, update [docs/SDK.md](docs/SDK.md) in the same change.

This includes changes to:

- `packages/sdk/src/index.ts`
- `packages/svelte/src/index.ts`
- exported types such as `Operation`, `RoomEvent`, `PresenceUser`, or room/store result types
- connection options, room options, mutation helpers, presence helpers, replay/event APIs, or Svelte store APIs

The SDK docs should explain what each public function/type does, show the expected call shape, and mention important behavior such as optimistic updates, rollback, throttling, offline queueing, and replay.

Before finishing SDK-related work, run:

```bash
bun run test
bun run build
bun run typecheck
```
