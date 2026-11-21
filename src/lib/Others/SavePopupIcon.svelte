<script lang="ts">
  import { OctagonAlert, SaveIcon } from "@lucide/svelte";
  import { alertNormal } from "src/ts/alert";
  import { getSavingStoppedDetail, saving } from "src/ts/globalApi.svelte";
  import { DBState, savingStoppedReason, peerWaitingStatus, frozenSaveKeysStore } from "src/ts/stores.svelte";
  import { language } from "src/lang";
  import { NODE_BODY_LIMIT_BYTES } from "src/ts/storage/nodeBodyLimit";
  import { storeAssetLimitBytes } from "src/ts/storage/assetLimit";
  import { pageStorageModeStore } from "src/ts/storage/pageStorageMode";
  import { heldSaveStore } from "src/ts/storage/saveHold";

  function heldMessage(held: { name: string, kind: 'unusable-id' | 'waiting', archived: boolean }[]){
    const waiting = held.filter((item) => item.kind === 'waiting')
    const paused = held.filter((item) => item.kind === 'unusable-id')
    const parts: string[] = []
    if(paused.length > 0){
      parts.push(language.savingHeldMessage(paused.map((item) => item.name).join(', '), paused.some((item) => item.archived)))
    }
    if(waiting.length > 0){
      parts.push(language.savingWaitingMessage(waiting.map((item) => item.name).join(', ')))
    }
    return parts.join('\n\n')
  }

  // A read-only page never starts the save loop, so its state comes from the
  // page's storage mode. The component is created before boot decides the
  // mode, so it follows the store, not a value read once.
  const readOnlyPage = $derived($pageStorageModeStore.kind === 'read-only')

  function savingStoppedMessage(reason: string){
    switch(reason){
      case 'node-conflict':
        return language.savingStoppedNodeConflictMessage
      case 'too-large':
        return language.savingStoppedTooLargeBlockMessage(getSavingStoppedDetail(), NODE_BODY_LIMIT_BYTES, storeAssetLimitBytes())
      case 'replaced':
        return language.savingStoppedReplacedMessage
      case 'conversion-failed':
        return language.savingStoppedConversionFailedMessage
      case 'unconfirmed':
        return language.savingStoppedUnconfirmedMessage
      case 'invalid-data':
        return language.savingStoppedInvalidDataMessage(getSavingStoppedDetail())
      default:
        return language.savingStoppedStayMessage
    }
  }

</script>

{#if readOnlyPage}
  <button class="absolute top-3 right-3 z-10 text-bgcolor bg-draculared hover:ring-2 hover:ring-textcolor p-2 rounded-sm" aria-label={language.savingIssueDetails} onclick={() =>{
      alertNormal(language.store2Boot.readOnlyRefusal)
  }}>
      <OctagonAlert size={24} aria-hidden="true" />
  </button>
{:else if $savingStoppedReason}
  <button class="absolute top-3 right-3 z-10 text-bgcolor bg-draculared hover:ring-2 hover:ring-textcolor p-2 rounded-sm" aria-label={language.savingIssueDetails} onclick={() =>{
      alertNormal(savingStoppedMessage($savingStoppedReason))
  }}>
      <OctagonAlert size={24} aria-hidden="true" />
  </button>
{:else if $frozenSaveKeysStore.length > 0}
  <button class="absolute top-3 right-3 z-10 text-bgcolor bg-draculared hover:ring-2 hover:ring-textcolor p-2 rounded-sm" aria-label={language.savingIssueDetails} onclick={() =>{
      const groups = $frozenSaveKeysStore.map((k) => k.names.join(' and ')).join('; ')
      alertNormal(language.duplicateChaIdSavePausedMessage(groups))
  }}>
      <OctagonAlert size={24} aria-hidden="true" />
  </button>
{:else if $heldSaveStore.length > 0}
  <button class="absolute top-3 right-3 z-10 text-bgcolor bg-draculared hover:ring-2 hover:ring-textcolor p-2 rounded-sm" aria-label={language.savingIssueDetails} onclick={() =>{
      alertNormal(heldMessage($heldSaveStore))
  }}>
      <OctagonAlert size={24} aria-hidden="true" />
  </button>
{:else if $peerWaitingStatus}
  <div
    role="status"
    class="absolute top-3 right-3 z-10 max-w-xs text-xs text-textcolor bg-darkbg border border-darkborderc p-2 rounded-sm pointer-events-none"
  >
    {language.store2Boot.peerWaitingSend}
  </div>
{:else if DBState?.db?.showSavingIcon && saving.state}
  <div
    class="absolute top-3 right-3 z-10 text-textcolor p-2 rounded-sm bg-linear-to-br from-borderc to-selected saving-animation pointer-events-none opacity-15"
  >
    <SaveIcon size={24} aria-hidden="true" />
  </div>
{/if}