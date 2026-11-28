<script lang="ts">
    import { ChevronDownIcon, ChevronRightIcon, MoreVerticalIcon } from '@lucide/svelte'
    import { language } from '../../lang'

    // The header of one preset folder in the "Manage presets" sheet. It holds only its own menu and rename state; the
    // sheet resolves every action by folder id when it runs, and the caller says whether a rename was accepted.
    interface Props {
        id: string
        name: string
        count: number
        collapsed: boolean
        first: boolean
        last: boolean
        busy: boolean
        ontoggle: () => void
        onrename: (text: string) => boolean
        onnewpreset: () => void
        ondelete: () => void
        onmoveup: () => void
        onmovedown: () => void
    }

    let { id, name, count, collapsed, first, last, busy, ontoggle, onrename, onnewpreset, ondelete, onmoveup, onmovedown }: Props = $props()

    let menuOpen = $state(false)
    let renaming = $state(false)
    let text = $state('')
    const itemClass = 'min-h-11 rounded px-2 text-start hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50'

    function startRename(): void {
        text = name
        renaming = true
    }

    function submit(): void {
        if (onrename(text)) {
            renaming = false
            menuOpen = false
        }
    }
</script>

<li data-part="studio-preset-folder" data-folder-id={id} class="flex flex-col rounded-md border border-darkborderc bg-darkbutton/30">
    <div class="flex items-stretch">
        <button type="button" data-part="studio-preset-folder-toggle" class="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-2 text-start cursor-pointer hover:bg-selected" aria-expanded={!collapsed} onclick={ontoggle}>
            {#if collapsed}<ChevronRightIcon size={16} aria-hidden="true" />{:else}<ChevronDownIcon size={16} aria-hidden="true" />{/if}
            <span class="min-w-0 flex-1 truncate font-bold">{name}</span>
            <span data-part="studio-preset-folder-count" class="shrink-0 text-xs text-textcolor2">{count}</span>
        </button>
        <button type="button" data-part="studio-preset-folder-menu-button" class="flex min-h-11 min-w-11 items-center justify-center cursor-pointer hover:bg-selected" aria-haspopup="menu" aria-expanded={menuOpen} aria-label={language.studioPresetFolderMenu(name)} onclick={() => { renaming = false; menuOpen = !menuOpen }}>
            <MoreVerticalIcon size={18} aria-hidden="true" />
        </button>
    </div>
    {#if menuOpen}
        <div role="menu" data-part="studio-preset-folder-menu" class="flex flex-col border-t border-darkborderc p-1">
            {#if renaming}
                <form class="flex flex-wrap items-center gap-2 p-1" onsubmit={(event) => { event.preventDefault(); submit() }}>
                    <input type="text" data-part="studio-preset-folder-rename-input" aria-label={language.studioPresetFolderName} class="min-h-11 min-w-0 flex-1 rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor" value={text} oninput={(event) => { text = event.currentTarget.value }} />
                    <button type="submit" data-part="studio-preset-folder-rename-apply" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer disabled:opacity-50" disabled={busy}>{language.studioPresetFolderRename}</button>
                    <button type="button" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" onclick={() => { renaming = false }}>{language.cancel}</button>
                </form>
            {:else}
                <button type="button" role="menuitem" data-part="studio-preset-folder-rename" class={itemClass} disabled={busy} onclick={startRename}>{language.studioPresetFolderRename}</button>
                <button type="button" role="menuitem" data-part="studio-preset-folder-new-preset" class={itemClass} disabled={busy} onclick={onnewpreset}>{language.studioPresetListNew}</button>
                <button type="button" role="menuitem" data-part="studio-preset-folder-up" class={itemClass} disabled={busy || first} onclick={onmoveup}>{language.chatShellMoveUp}</button>
                <button type="button" role="menuitem" data-part="studio-preset-folder-down" class={itemClass} disabled={busy || last} onclick={onmovedown}>{language.chatShellMoveDown}</button>
                <button type="button" role="menuitem" data-part="studio-preset-folder-delete" class="{itemClass} text-draculared" disabled={busy} onclick={ondelete}>{language.studioPresetFolderDelete}</button>
            {/if}
        </div>
    {/if}
</li>