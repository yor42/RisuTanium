<script lang="ts">
  import { language } from "src/lang";
  import Button from "src/lib/UI/GUI/Button.svelte";
  import Check from "src/lib/UI/GUI/CheckInput.svelte";
  import { DBState } from "src/ts/stores.svelte";
  import { discardChroMemoryIndex, type ChroMemoryTrace } from "src/ts/process/memory/chroMemory/shadow";
  import { readLtmSettings, writeLtmSettings } from "src/ts/process/memory/chroMemory/settings";

  interface Props {
    trace: Readonly<ChroMemoryTrace> | null;
    chatKey: string;
    /** This chat's index was discarded and no send has rebuilt it yet. */
    discarded: boolean;
  }

  let { trace, chatKey, discarded }: Props = $props();

  const shadow = $derived(readLtmSettings(DBState.db.ltmSettings, 0).shadow);

  function buildText(cause: ChroMemoryTrace["rebuildCause"]): string {
    switch (cause) {
      case "fresh": return language.chroMemoryBuildFresh;
      case "chat-switch": return language.chroMemoryBuildChatSwitch;
      case "tail-shrink":
      case "mid-removal": return language.chroMemoryBuildChanged;
      default: return language.chroMemoryBuildNone;
    }
  }

  function rebuild() {
    if (chatKey) discardChroMemoryIndex(chatKey);
  }
</script>

{#if trace && trace.index && !discarded}
  <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
    <div class="p-2 border rounded-md bg-bgcolor/50 border-darkborderc">
      <div class="text-xs text-textcolor2">{language.chroMemoryUnits}</div>
      <div class="text-lg font-semibold tabular-nums text-textcolor">{trace.index.units}</div>
    </div>
    <div class="p-2 border rounded-md bg-bgcolor/50 border-darkborderc">
      <div class="text-xs text-textcolor2">{language.chroMemoryChurn}</div>
      <div class="text-lg font-semibold tabular-nums text-textcolor">{Math.round(trace.index.churn * 100)}%</div>
    </div>
    <div class="p-2 border rounded-md bg-bgcolor/50 border-darkborderc">
      <div class="text-xs text-textcolor2">{language.chroMemoryTimeBox}</div>
      <div class="text-lg font-semibold text-textcolor">{language.chroMemoryTimeBoxOff}</div>
    </div>
    <div class="p-2 border rounded-md bg-bgcolor/50 border-darkborderc">
      <div class="text-xs text-textcolor2">{language.chroMemoryLastBuild}</div>
      <div class="text-sm font-semibold wrap-break-word text-textcolor">{buildText(trace.rebuildCause)}</div>
    </div>
  </div>
{/if}

<div class="flex flex-col gap-1">
  <Check check={shadow} name={language.chroMemoryShadow} onChange={(v) => writeLtmSettings(DBState.db, { shadow: v })} />
  <span class="text-sm text-textcolor2">{language.chroMemoryShadowDesc}</span>
</div>

<div class="flex flex-col gap-1">
  <div>
    <Button onclick={rebuild}>{language.chroMemoryRebuild}</Button>
  </div>
  <span class="text-sm text-textcolor2">{language.chroMemoryRebuildDesc}</span>
  {#if discarded}
    <span class="text-sm text-textcolor" role="status">{language.chroMemoryRebuilt}</span>
  {/if}
</div>
