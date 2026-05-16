import { createClient } from "@oculus/sdk";

const names = ["Ada", "Grace", "Linus", "Katherine", "Dennis", "Radia"];
const colors = ["#2563eb", "#0f766e", "#dc2626", "#9333ea", "#ca8a04", "#0891b2"];

function sessionValue(key: string, fallback: () => string): string {
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const value = fallback();
  sessionStorage.setItem(key, value);
  return value;
}

export const userName = sessionValue(
  "oculus_demo_name",
  () => names[Math.floor(Math.random() * names.length)] ?? "Builder"
);
export const userColor = sessionValue(
  "oculus_demo_color",
  () => colors[Math.floor(Math.random() * colors.length)] ?? "#2563eb"
);
export const userId = sessionValue("oculus_demo_user_id", () =>
  `${userName.toLowerCase()}-${Math.random().toString(36).slice(2, 7)}`
);

export const client = createClient({
  serverUrl: import.meta.env.VITE_OCULUS_SERVER_URL ?? "http://localhost:3000",
  userId
});
