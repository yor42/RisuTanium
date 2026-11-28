<script lang="ts">
    import { GripVerticalIcon, MoreVerticalIcon } from '@lucide/svelte'
    import { language } from '../../lang'
    import { presetNameOf } from '../../ts/studio/edit/presetTarget'

    // One preset of the "Manage presets" sheet. The row holds no preset data: it shows what the sheet passes and reports
    // taps, and every action is resolved by id in the sheet's actions at the moment it runs.
    interface Props {
        id: string
        active: boolean
        slot: number | undefined
        highlighted: boolean
        menuOpen: boolean
        renaming: boolean
        renameText: string
        busy: boolean
        folders: { id: string, name: string }[]
        folderId: string | undefined
        moveOpen: boolean
        slotOpen: boolean
        first: boolean
        last: boolean
        onopen: () => void
        onmenu: () => void
        onuse: () => void
        oncopy: () => void
        onrename: () => void
        onmoveopen: () => void
        onslotopen: () => void
        onslot: (slot: number | null) => void
        onup: () => void
        ondown: () => void
        ondropon: (sourceId: string) => void
        onmoveto: (folderId: string | undefined) => void
        ondelete: () => void
        onrenametext: (text: string) => void
        onrenamesubmit: () => void
        onrenamecancel: () => void
    }

    let { id, active, slot, highlighted, menuOpen, renaming, renameText, busy, folders, folderId, moveOpen, slotOpen, first, last, onopen, onmenu, onuse, oncopy, onrename, onmoveopen, onslotopen, onslot, onup, ondown, ondropon, onmoveto, ondelete, onrenametext, onrenamesubmit, onrenamecancel }: Props = $props()

    const name = $derived(presetNameOf(id))
    const DRAG_TYPE = 'application/x-risu-studio-preset'
    const slots = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    const itemClass = 'min-h-11 rounded px-2 text-start hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50'
</script>

<li data-part="studio-preset-row" data-preset-id={id} data-active={active ? 'true' : undefined} class="flex flex-col rounded-md border border-darkborderc" class:bg-selected={highlighted} ondragover={(event) => { if (event.dataTransfer?.types.includes(DRAG_TYPE)) event.preventDefault() }} ondrop={(event) => { const source = event.dataTransfer?.getData(DRAG_TYPE); if (source) { event.preventDefault(); ondropon(source) } }}>
    <div class="flex items-stretch">
        <span data-part="studio-preset-drag" role="img" draggable="true" aria-label={language.studioPresetDragHandle(name)} class="hidden min-w-8 cursor-grab items-center justify-center text-textcolor2 [@media(pointer:fine)]:flex" ondragstart={(event) => { event.dataTransfer?.setData(DRAG_TYPE, id) }}>
            <GripVerticalIcon size={16} aria-hidden="true" />
        </span>
        <button type="button" data-part="studio-preset-open" class="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-2 text-start cursor-pointer hover:bg-selected" onclick={onopen}>
            <span class="min-w-0 flex-1 truncate">{name}</span>
            {#if slot !== undefined}
                <span data-part="studio-preset-slot" class="shrink-0 rounded border border-darkborderc px-1 text-xs text-textcolor2" aria-label={language.settingsShellHkPresetSlot(slot)}>{slot}</span>
            {/if}
            {#if active}
                <span data-part="studio-preset-active" class="shrink-0 rounded border border-darkborderc px-1 text-xs text-textcolor2">{language.studioPresetListActive}</span>
            {/if}
        </button>
        <button type="button" data-part="studio-preset-menu-button" class="flex min-h-11 min-w-11 items-center justify-center cursor-pointer hover:bg-selected" aria-haspopup="menu" aria-expanded={menuOpen} aria-label={language.studioPresetRowMenu(name)} onclick={onmenu}>
            <MoreVerticalIcon size={18} aria-hidden="true" />
        </button>
    </div>
    {#if menuOpen}
        <div role="menu" data-part="studio-preset-menu" class="flex flex-col border-t border-darkborderc p-1">
            {#if renaming}
                <form class="flex flex-wrap items-center gap-2 p-1" onsubmit={(event) => { event.preventDefault(); onrenamesubmit() }}>
                    <input type="text" data-part="studio-preset-rename-input" aria-label={language.name} class="min-h-11 min-w-0 flex-1 rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor" value={renameText} oninput={(event) => onrenametext(event.currentTarget.value)} />
                    <button type="submit" data-part="studio-preset-rename-apply" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer disabled:opacity-50" disabled={busy}>{language.studioPresetRename}</button>
                    <button type="button" data-part="studio-preset-rename-cancel" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" onclick={onrenamecancel}>{language.cancel}</button>
                </form>
            {:else if slotOpen}
                <div data-part="studio-preset-slot-list" class="flex flex-wrap gap-1 p-1">
                    {#each slots as n (n)}
                        <button type="button" role="menuitem" data-part="studio-preset-slot-choice" data-slot={n} class="{itemClass} min-w-11 text-center" aria-label={language.settingsShellHkPresetSlot(n)} aria-current={slot === n ? 'true' : undefined} disabled={busy} onclick={() => onslot(n)}>{n}</button>
                    {/each}
                    <button type="button" role="menuitem" data-part="studio-preset-slot-none" class={itemClass} disabled={busy || slot === undefined} onclick={() => onslot(null)}>{language.settingsShellHkSlotNone}</button>
                </div>
            {:else if moveOpen}
                <button type="button" role="menuitem" data-part="studio-preset-move-none" class={itemClass} aria-current={folderId === undefined ? 'true' : undefined} disabled={busy} onclick={() => onmoveto(undefined)}>{language.studioPresetNoFolder}</button>
                {#each folders as folder, at (at)}
                    <button type="button" role="menuitem" data-part="studio-preset-move-to" data-folder-id={folder.id} class={itemClass} aria-current={folderId === folder.id ? 'true' : undefined} disabled={busy} onclick={() => onmoveto(folder.id)}>{folder.name}</button>
                {/each}
            {:else}
                <button type="button" role="menuitem" data-part="studio-preset-use" class={itemClass} disabled={active || busy} onclick={onuse}>{language.studioPresetUse}</button>
                <button type="button" role="menuitem" data-part="studio-preset-copy" class={itemClass} disabled={busy} onclick={oncopy}>{language.copy}</button>
                <button type="button" role="menuitem" data-part="studio-preset-rename" class={itemClass} disabled={busy} onclick={onrename}>{language.studioPresetRename}</button>
                <button type="button" role="menuitem" data-part="studio-preset-slot-menu" class={itemClass} disabled={busy} onclick={onslotopen}>{language.studioPresetSlotMenu}</button>
                <button type="button" role="menuitem" data-part="studio-preset-up" class={itemClass} disabled={busy || first} onclick={onup}>{language.chatShellMoveUp}</button>
                <button type="button" role="menuitem" data-part="studio-preset-down" class={itemClass} disabled={busy || last} onclick={ondown}>{language.chatShellMoveDown}</button>
                <button type="button" role="menuitem" data-part="studio-preset-move" class={itemClass} disabled={busy} onclick={onmoveopen}>{language.studioPresetMoveToFolder}</button>
                <button type="button" role="menuitem" data-part="studio-preset-delete" class="{itemClass} text-draculared" disabled={busy} onclick={ondelete}>{language.remove}</button>
            {/if}
        </div>
    {/if}
</li>
