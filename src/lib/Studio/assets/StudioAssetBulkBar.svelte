<script lang="ts">
    import { language } from '../../../lang'
    import type { MoveChoice } from './StudioAssetRow.svelte'

    // The bar over a bulk selection: select all shown, the count and the actions. It shows what the list hands it and
    // reports what the person did; the list decides which rows are selected and runs every action.
    interface Props {
        // Selected rows that are shown, and the rows shown.
        count: number
        shown: number
        editable: boolean
        moveChoices: MoveChoice[]
        // The preview action offered, or null while the preview setting is off.
        previewAction: 'leave' | 'include' | null
        onselectall: (on: boolean) => void
        onmove: (folder: string | null) => void
        ondelete: () => void
        onpreview: () => void
    }

    let { count, shown, editable, moveChoices, previewAction, onselectall, onmove, ondelete, onpreview }: Props = $props()

    let moveOpen = $state(false)
    const none = $derived(count === 0 || !editable)
    const buttonClass = 'min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50'
</script>

<div data-part="studio-asset-bulkbar" class="flex flex-wrap items-center gap-2 rounded-md border border-darkborderc p-2">
    <label class="flex min-h-11 items-center gap-2 cursor-pointer">
        <input
            type="checkbox"
            data-part="studio-asset-select-all"
            class="h-5 w-5 cursor-pointer"
            aria-label={language.studioAssetSelectAll}
            checked={shown > 0 && count === shown}
            disabled={shown === 0}
            onchange={(event) => onselectall(event.currentTarget.checked)}
        />
        <span>{language.studioAssetSelectAll}</span>
    </label>
    <span data-part="studio-asset-selected-count" role="status" class="text-sm text-textcolor2">{language.studioAssetSelectedCount(count)}</span>
    {#if moveChoices.length > 0}
        <button type="button" data-part="studio-asset-bulk-move" class={buttonClass} aria-expanded={moveOpen} disabled={none} onclick={() => { moveOpen = !moveOpen }}>{language.studioAssetMoveToFolder}</button>
    {/if}
    <button type="button" data-part="studio-asset-bulk-delete" class={buttonClass} disabled={none} onclick={ondelete}>{language.studioAssetDelete}</button>
    {#if previewAction !== null}
        <button type="button" data-part="studio-asset-bulk-preview" class={buttonClass} disabled={none} onclick={onpreview}>{previewAction === 'include' ? language.studioAssetShowInPreview : language.studioAssetHideFromPreview}</button>
    {/if}
    {#if moveOpen && !none}
        <div class="flex w-full flex-wrap gap-2">
            {#each moveChoices as choice (choice.value ?? '')}
                <button type="button" data-part="studio-asset-bulk-move-choice" data-folder={choice.value ?? ''} class={buttonClass} onclick={() => { moveOpen = false; onmove(choice.value) }}>{choice.label}</button>
            {/each}
        </div>
    {/if}
</div>
