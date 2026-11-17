<script lang="ts">
    import { language } from '../../../lang'

    // The header of one folder group: the collapse toggle, and for a listed folder its rename and delete actions. It
    // shows what the list hands it and reports what the person did; every write belongs to the list.
    interface Props {
        // The folder's name, or the "No folder" label.
        label: string
        // The rows the folder holds, shown or not.
        count: number
        expanded: boolean
        // Rename and delete exist for a listed folder only, and only while the owner accepts edits.
        actionable: boolean
        // The actions are shown and off: the owner is read-only.
        disabled?: boolean
        // The rename field is open.
        editing: boolean
        ontoggle: () => void
        onstartrename: () => void
        ondelete: () => void
        // Returns true when the field may close: the name landed or was already the folder's own.
        oncommitrename: (value: string) => boolean
        oncancelrename: () => void
    }

    let { label, count, expanded, actionable, disabled = false, editing, ontoggle, onstartrename, ondelete, oncommitrename, oncancelrename }: Props = $props()

    // A key that ends the edit by itself must not be followed by the blur it causes.
    let finished = false

    function focusField(node: HTMLInputElement): void {
        finished = false
        node.focus()
        node.select()
    }

    function onkeydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }): void {
        // An IME confirms its composition with Enter: that key belongs to the IME.
        if (event.isComposing || event.keyCode === 229) return
        if (event.key === 'Enter') {
            event.preventDefault()
            if (oncommitrename(event.currentTarget.value)) finished = true
        } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            finished = true
            oncancelrename()
        }
    }

    function onblur(event: FocusEvent & { currentTarget: HTMLInputElement }): void {
        if (finished) return
        // Leaving the field with a refused name keeps it open, with the refusal shown by the list.
        if (oncommitrename(event.currentTarget.value)) finished = true
    }

    const buttonClass = 'min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50'
</script>

<div class="flex flex-wrap items-center gap-2">
    <button
        type="button"
        data-part="studio-asset-folder-header"
        class="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-start font-bold hover:bg-selected cursor-pointer"
        aria-expanded={expanded}
        onclick={ontoggle}
    >
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        <span class="min-w-0 break-words">{label}</span>
        <span class="shrink-0 text-sm font-normal text-textcolor2">{count}</span>
    </button>
    {#if actionable}
        {#if editing && !disabled}
            <input
                use:focusField
                type="text"
                data-part="studio-asset-folder-name"
                class="min-h-11 min-w-0 flex-1 rounded-md border border-darkborderc bg-darkbg px-2 text-textcolor"
                aria-label={language.studioAssetRenameFolder}
                autocomplete="off"
                value={label}
                {onkeydown}
                {onblur}
            />
        {:else}
            <button type="button" data-part="studio-asset-folder-rename" class={buttonClass} {disabled} onclick={onstartrename}>{language.studioAssetRenameFolder}</button>
        {/if}
        <button type="button" data-part="studio-asset-folder-delete" class={buttonClass} {disabled} onclick={ondelete}>{language.studioAssetDeleteFolder}</button>
    {/if}
</div>
