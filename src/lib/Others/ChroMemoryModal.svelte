<script lang="ts">
  import { get } from "svelte/store";
  import { XIcon } from "@lucide/svelte";
  import { backCloseHandler, registerBackHandler } from "src/ts/backHandlers";
  import { language } from "src/lang";
  import { DBState, selectedCharID, hypaV3ModalOpen } from "src/ts/stores.svelte";
  import { chroMemoryDiscarded, chroMemoryTrace } from "src/ts/process/memory/chroMemory/traceStore";
  import LastSendTab from "./ChroMemoryModal/last-send-tab.svelte";
  import IndexTab from "./ChroMemoryModal/index-tab.svelte";

  const uid = $props.id();

  type Tab = "last" | "index";
  let tab = $state<Tab>("last");

  const char = $derived(DBState.db.characters[$selectedCharID]);
  const chat = $derived(char?.chats?.[char.chatPage]);
  // The key the engine publishes its trace under: the owner's id and the chat's id.
  const chatKey = $derived(char && chat ? `${char.chaId}:${chat.id ?? ""}` : "");
  const trace = $derived($chroMemoryTrace && $chroMemoryTrace.chatKey === chatKey ? $chroMemoryTrace : null);
  const discarded = $derived(chatKey !== "" && $chroMemoryDiscarded === chatKey);

  function closeModal() {
    $hypaV3ModalOpen = false;
  }

  // Back does what the X does. The effect reads no reactive state.
  $effect(() => registerBackHandler(backCloseHandler({
    isOpen: () => get(hypaV3ModalOpen),
    snapshot: () => get(hypaV3ModalOpen),
    close: closeModal,
  })));

  const tabs: { id: Tab; label: () => string }[] = [
    { id: "last", label: () => language.chroMemoryTabLastSend },
    { id: "index", label: () => language.chroMemoryTabIndex },
  ];
</script>

<!-- Modal Backdrop -->
<div class="fixed inset-0 z-40 p-1 sm:p-2 bg-black/50">
  <div class="flex justify-center w-full h-full">
    <div class="flex flex-col w-full max-w-3xl p-3 rounded-lg sm:p-6 bg-darkbg h-full sm:h-fit sm:max-h-full">
      <div class="flex items-center justify-between mb-2 sm:mb-4">
        <h1 id="{uid}-title" class="text-lg font-semibold sm:text-2xl text-textcolor">{language.chroMemoryModal}</h1>
        <button
          type="button"
          class="p-2 transition-colors text-textcolor2 hover:text-textcolor risu-focus-ring rounded-md"
          aria-label={language.uiCommon.close}
          onclick={closeModal}
        >
          <XIcon class="w-6 h-6" aria-hidden="true" />
        </button>
      </div>

      <div role="tablist" aria-labelledby="{uid}-title" class="flex gap-4 mb-3 border-b border-darkborderc">
        {#each tabs as t (t.id)}
          <button
            type="button"
            role="tab"
            id="{uid}-tab-{t.id}"
            aria-selected={tab === t.id}
            aria-controls="{uid}-panel-{t.id}"
            class="pb-2 -mb-px text-sm border-b-2 risu-focus-ring transition-colors {tab === t.id
              ? 'border-selected text-textcolor'
              : 'border-transparent text-textcolor2 hover:text-textcolor'}"
            onclick={() => (tab = t.id)}
          >
            {t.label()}
          </button>
        {/each}
      </div>

      <div
        role="tabpanel"
        id="{uid}-panel-{tab}"
        aria-labelledby="{uid}-tab-{tab}"
        class="flex flex-col gap-3 overflow-y-auto"
      >
        {#if tab === "last"}
          <LastSendTab {trace} messages={chat?.message} />
        {:else}
          <IndexTab {trace} {chatKey} {discarded} />
        {/if}
      </div>
    </div>
  </div>
</div>
