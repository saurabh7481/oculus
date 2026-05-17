<script lang="ts">
  const PALETTE = [
    { name: "Yellow", value: "#fef9c3" },
    { name: "Amber", value: "#fef3c7" },
    { name: "Orange", value: "#ffedd5" },
    { name: "Rose", value: "#ffe4e6" },
    { name: "Pink", value: "#fce7f3" },
    { name: "Purple", value: "#f3e8ff" },
    { name: "Indigo", value: "#e0e7ff" },
    { name: "Blue", value: "#dbeafe" },
    { name: "Cyan", value: "#cffafe" },
    { name: "Teal", value: "#ccfbf1" },
    { name: "Green", value: "#dcfce7" },
    { name: "Slate", value: "#f1f5f9" },
  ];

  let { value, onchange }: { value?: string; onchange: (color: string) => void } = $props();
</script>

<div class="color-picker">
  {#each PALETTE as swatch (swatch.value)}
    <button
      aria-label={swatch.name}
      data-testid="color-swatch"
      data-color={swatch.value}
      class:active={value === swatch.value}
      style="background: {swatch.value};"
      onclick={() => onchange(swatch.value)}
    ></button>
  {/each}
</div>
