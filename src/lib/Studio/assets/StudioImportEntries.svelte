<script lang="ts">
    import { language } from '../../../lang'
    import { dropImportEntry, importEntriesOf, retryImportEntry, type ImportArray } from '../../../ts/studio/assets/studioImport.svelte'
    import type { OwnerKey } from '../../../ts/studio/history/ownerPhase'

    // The files of an Add that are still storing, or that failed to store and wait for a retry or a removal. A file that
    // stored is a row of the list and is not shown here.
    interface Props {
        owner: OwnerKey
        array: ImportArray
    }

    let { owner, array }: Props = $props()

    const entries = $derived(importEntriesOf(owner, array))
</script>

{#if entries.length > 0}
    <ul data-part="studio-import-entries" class="flex flex-col gap-2">
        {#each entries as entry (entry.id)}
            <li data-part="studio-import-entry" data-state={entry.state} class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-darkborderc p-2">
                <span class="min-w-0 flex-1 break-all">{entry.name}</span>
                {#if entry.state === 'storing'}
                    <span class="text-sm text-textcolor2">{language.studioImporting}</span>
                {:else}
                    <span class="text-sm text-draculared">{language.studioStoreFail}</span>
                    <button type="button" data-part="studio-import-retry" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" onclick={() => void retryImportEntry(entry.batchId, entry.id)}>{language.studioChipRetry}</button>
                    <button type="button" data-part="studio-import-drop" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" onclick={() => dropImportEntry(entry.batchId, entry.id)}>{language.studioDropRow}</button>
                {/if}
            </li>
        {/each}
    </ul>
{/if}
