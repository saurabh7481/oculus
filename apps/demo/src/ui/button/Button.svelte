<script lang="ts">
  import { cn } from "../../lib/cn";

  type Variant = "default" | "primary" | "secondary" | "ghost" | "danger";
  type Size = "sm" | "md" | "icon";

  let {
    variant = "default",
    size = "md",
    class: className = "",
    type = "button",
    disabled = false,
    children,
    onclick,
    ...rest
  }: {
    variant?: Variant;
    size?: Size;
    class?: string;
    type?: "button" | "submit" | "reset";
    disabled?: boolean;
    children?: import("svelte").Snippet;
    onclick?: (event: MouseEvent) => void;
    [key: string]: unknown;
  } = $props();

  const variants: Record<Variant, string> = {
    default: "border-slate-300 bg-white text-slate-950 hover:border-blue-600 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
    primary: "border-blue-700 bg-blue-600 text-white hover:border-blue-800 hover:bg-blue-700 hover:text-white",
    secondary: "border-slate-200 bg-slate-100 text-slate-800 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100",
    ghost: "border-transparent bg-transparent text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800",
    danger: "border-slate-300 bg-white text-slate-950 hover:border-red-600 hover:text-red-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
  };

  const sizes: Record<Size, string> = {
    sm: "min-h-8 px-2.5 text-sm",
    md: "min-h-9 px-3 text-sm",
    icon: "h-9 min-h-9 w-9 p-0"
  };
</script>

<button
  {...rest}
  {type}
  {disabled}
  {onclick}
  class={cn(
    "inline-flex items-center justify-center gap-2 rounded-lg border font-medium transition-colors disabled:pointer-events-none disabled:opacity-45",
    variants[variant],
    sizes[size],
    className
  )}
>
  {@render children?.()}
</button>
