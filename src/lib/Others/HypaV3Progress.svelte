<script lang="ts">
  import { hypaV3ProgressStore } from "src/ts/stores.svelte";

  let isExpanded = $state(false);

  const toggleExpand = () => {
    isExpanded = !isExpanded;
  };
</script>

{#if isExpanded}
  <div
    data-part="memory-progress"
    class="absolute w-full h-full z-40 flex justify-center items-center pointer-events-none"
  >
    <button
      data-part="memory-progress-card"
      class="bg-darkbg p-4 break-any rounded-md flex flex-col max-w-3xl max-h-full overflow-y-auto transition-opacity duration-300 pointer-events-auto"
      type="button"
      onclick={toggleExpand}
    >
      <span data-part="memory-progress-text" class="mb-6 text-left text-gray-500 text-sm"
        >{$hypaV3ProgressStore.msg || ""}</span
      >
      <div
        data-part="memory-progress-bar"
        class="w-full min-w-64 md:min-w-138 h-2 bg-darkbg border border-darkborderc rounded-md"
      >
        <div
          data-part="memory-progress-bar-fill"
          class="h-full bg-linear-to-r from-blue-500 to-purple-800 saving-animation transition-[width]"
        ></div>
      </div>
      <span data-part="memory-progress-subtext" class="w-full mt-6 text-center text-gray-500 text-sm"
        >{$hypaV3ProgressStore.subMsg || ""}</span
      >
    </button>
  </div>
{:else}
  <button
    data-part="memory-progress-pill"
    class="fixed top-4 right-4 z-40 bg-darkbg p-2 rounded-full shadow-lg transition-all duration-300 flex items-center justify-center"
    type="button"
    style="opacity: 0.8;"
    onclick={toggleExpand}
    onmouseenter={(e) => (e.currentTarget.style.opacity = "1")}
    onmouseleave={(e) => (e.currentTarget.style.opacity = "0.8")}
  >
    <div class="w-8 h-8 relative">
      <div
        class="absolute inset-0 border-t-2 border-red-500 rounded-full animate-spin"
      ></div>
      <div
        data-part="memory-progress-mini"
        class="absolute inset-1 flex items-center justify-center text-xs text-gray-300"
      >
        {$hypaV3ProgressStore.miniMsg || ""}
      </div>
    </div>
  </button>
{/if}
