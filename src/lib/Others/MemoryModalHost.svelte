<script lang="ts">
  import { DBState, hypaV3ModalOpen } from "src/ts/stores.svelte";
  import { chroMemoryOn, legacyEngineFields } from "src/ts/process/memory/memoryEngine";
  import ChroMemoryModal from "./ChroMemoryModal.svelte";
  import HypaV3Modal from "./HypaV3Modal.svelte";

  // The one memory modal the open flag shows. HypaV3Modal never mounts while ChroMemory is on or
  // the engine is not V3, because it creates `hypaV3Data` on the open chat.
  const showChro = $derived(chroMemoryOn(DBState.db));
  const showV3 = $derived(!showChro && !!legacyEngineFields(DBState.db).hypaV3);

  $effect(() => {
    if ($hypaV3ModalOpen && !showChro && !showV3) $hypaV3ModalOpen = false;
  });
</script>

{#if showChro}
  <ChroMemoryModal />
{:else if showV3}
  <HypaV3Modal />
{/if}
