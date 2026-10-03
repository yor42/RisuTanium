<script lang="ts">
    import { language } from "src/lang";
    import { isTauri } from "src/ts/platform"
    import { DBState } from "src/ts/stores.svelte";
    import Check from "src/lib/UI/GUI/CheckInput.svelte";
    import { verifyAssetIntegrity } from "src/ts/storage/storageMaintenance";
</script>

{#if !isTauri}
    <h2 class="mb-2 text-2xl font-bold mt-6">{language.assetIntegrityHeading}</h2>
    <p class="text-sm opacity-70 mb-2">{language.assetIntegrityDescription}</p>
    <Check bind:check={DBState.db.checkCorruption} name={language.assetIntegrityWarnOnStartup} />
    <button
        onclick={verifyAssetIntegrity}
        class="drop-shadow-lg p-3 border-darkborderc border-solid mt-2 flex justify-center items-center ml-2 mr-2 border-1 hover:bg-selected text-sm">
        {language.assetIntegrityVerifyButton}
    </button>
{/if}
