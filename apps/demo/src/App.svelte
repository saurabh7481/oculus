<script lang="ts">
  import { onMount } from "svelte";
  import AppShell from "./app/AppShell.svelte";
  import RoomHome from "./app/RoomHome.svelte";

  type RoomKind = "whiteboard" | "workflow";
  type Route =
    | { name: "home" }
    | { name: "room"; kind: RoomKind; roomId: string };

  let route = parseRoute(location.pathname);

  onMount(() => {
    const handlePopState = () => {
      route = parseRoute(location.pathname);
    };
    addEventListener("popstate", handlePopState);
    return () => removeEventListener("popstate", handlePopState);
  });

  function parseRoute(pathname: string): Route {
    const [, maybeKind, roomId] = pathname.split("/");
    if ((maybeKind === "whiteboard" || maybeKind === "workflow") && roomId) {
      return { name: "room", kind: maybeKind, roomId };
    }
    return { name: "home" };
  }

  function createRoom(kind: RoomKind) {
    const roomId = `room_${crypto.randomUUID().slice(0, 8)}`;
    navigate(`/${kind}/${roomId}`);
  }

  function navigate(pathname: string) {
    history.pushState({}, "", pathname);
    route = parseRoute(pathname);
  }
</script>

{#if route.name === "home"}
  <RoomHome onCreate={createRoom} />
{:else}
  <AppShell roomId={route.roomId} initialEnvironment={route.kind} />
{/if}
