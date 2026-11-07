<script lang="ts">
    import { untrack } from 'svelte'
    import { language } from 'src/lang'
    import type { ChatFolder } from '../../../ts/storage/database.svelte'
    import type { MenuTarget } from '../../../ts/chatShell/chatListEdits'
    import { isArchivedChat } from '../../../ts/chatShell/chatListModel'
    import { getFolderColorLabels, getFolderColorValue } from '../../SideBars/folderColors'
    import ShellSheet from '../ShellSheet.svelte'

    /**
     * The menu of one chat row or folder header in the new shell's sidebar. It only offers the actions and reports the
     * choice; the sidebar does the work and closes the menu. The only chat of a character cannot be deleted and an
     * archived chat cannot be duplicated: those items stay visible, say why, and do nothing when activated.
     */
    interface Props {
        // Null while closed.
        target: MenuTarget | null
        folders: readonly ChatFolder[]
        // The owner has just this chat.
        soleChat: boolean
        onclose: () => void
        onrename: () => void
        // A folder id, or null for no folder.
        onmove: (folderId: string | null) => void
        onnewfolder: () => void
        onduplicate: (event: MouseEvent) => void
        onexport: () => void
        ondelete: () => void
        onfoldercolor: (color: string) => void
        onfolderdelete: () => void
    }

    let { target, folders, soleChat, onclose, onrename, onmove, onnewfolder, onduplicate, onexport, ondelete, onfoldercolor, onfolderdelete }: Props = $props()

    const uid = $props.id()
    let wide = $state(false)
    let moveOpen = $state(false)
    let colourOpen = $state(false)

    $effect(() => {
        if (typeof matchMedia !== 'function') return
        const query = matchMedia('(min-width: 900px) and (hover: hover)')
        const update = () => { wide = query.matches }
        update()
        query.addEventListener('change', update)
        return () => query.removeEventListener('change', update)
    })

    // Every opening starts with the sub-lists closed.
    $effect(() => {
        void target
        untrack(() => {
            moveOpen = false
            colourOpen = false
        })
    })

    const colours = getFolderColorLabels().map((label, index) => ({ label, value: getFolderColorValue(index) ?? '' }))

    const chat = $derived(target?.kind === 'chat' ? target.chat : null)
    const folder = $derived(target?.kind === 'folder' ? target.folder : null)
    const archived = $derived(chat ? isArchivedChat(chat) : false)
    const unfiled = $derived(chat ? chat.folderId == null || !folders.some((candidate) => candidate.id === chat.folderId) : false)
    const label = $derived(chat ? language.chatShellRowMenu(chat.name || language.settingsPage.unnamed) : folder ? language.chatShellFolderMenu(folder.name || language.settingsPage.unnamed) : '')
</script>

<ShellSheet open={target !== null} kind="menu" mode={wide ? 'wide-menu' : 'action'} anchor={target?.anchor} {label} opener={target?.opener ?? null} inertOutside {onclose}>
    <div data-part="row-menu" data-kind={target?.kind}>
        {#if chat}
            <button type="button" role="menuitem" data-action="rename" data-sheet-initial onclick={() => onrename()}>{language.chatShellRename}</button>
            <button type="button" role="menuitem" data-action="move" aria-haspopup="true" aria-expanded={moveOpen} onclick={() => { moveOpen = !moveOpen }}>{language.chatShellMoveToFolder}</button>
            {#if moveOpen}
                <div data-part="row-menu-group" role="group" aria-label={language.chatShellMoveToFolder}>
                    <button type="button" role="menuitemradio" aria-checked={unfiled} data-action="move-none" onclick={() => onmove(null)}>{language.chatShellNoFolder}</button>
                    {#each folders as option (option.id)}
                        <button type="button" role="menuitemradio" aria-checked={chat.folderId === option.id} data-action="move-{option.id}" onclick={() => onmove(option.id)}>{option.name || language.settingsPage.unnamed}</button>
                    {/each}
                    <button type="button" role="menuitem" data-action="move-new" onclick={() => onnewfolder()}>{language.chatShellNewFolder}</button>
                </div>
            {/if}
            <button type="button" role="menuitem" data-action="duplicate" aria-disabled={archived ? 'true' : undefined} aria-describedby={archived ? `${uid}-duplicate-why` : undefined} onclick={(event) => { if (!archived) onduplicate(event) }}>{language.chatShellDuplicate}</button>
            {#if archived}
                <p id="{uid}-duplicate-why" data-part="row-menu-reason">{language.chatShellDuplicateArchived}</p>
            {/if}
            <button type="button" role="menuitem" data-action="export" onclick={() => onexport()}>{language.chatShellExportChat}</button>
            <button type="button" role="menuitem" data-action="delete" data-destructive aria-disabled={soleChat ? 'true' : undefined} aria-describedby={soleChat ? `${uid}-delete-why` : undefined} onclick={() => { if (!soleChat) ondelete() }}>{language.chatShellDeleteChat}</button>
            {#if soleChat}
                <p id="{uid}-delete-why" data-part="row-menu-reason">{language.chatShellDeleteOnlyChat}</p>
            {/if}
        {:else if folder}
            <button type="button" role="menuitem" data-action="folder-rename" data-sheet-initial onclick={() => onrename()}>{language.chatShellRenameFolder}</button>
            <button type="button" role="menuitem" data-action="folder-colour" aria-haspopup="true" aria-expanded={colourOpen} onclick={() => { colourOpen = !colourOpen }}>{language.changeFolderColor}</button>
            {#if colourOpen}
                <div data-part="row-menu-group" role="group" aria-label={language.changeFolderColor}>
                    {#each colours as colour (colour.value)}
                        <button type="button" role="menuitemradio" aria-checked={folder.color === colour.value} data-action="colour-{colour.value}" onclick={() => onfoldercolor(colour.value)}>{colour.label}</button>
                    {/each}
                </div>
            {/if}
            <button type="button" role="menuitem" data-action="folder-delete" data-destructive onclick={() => onfolderdelete()}>{language.chatShellDeleteFolder}</button>
        {/if}
    </div>
</ShellSheet>

<style>
    [data-part="row-menu"] { display: flex; flex-direction: column; gap: var(--space-5); padding: var(--space-5); }
    [data-part="row-menu-group"] { display: flex; flex-direction: column; gap: var(--space-5); padding-inline-start: var(--space-7); }
    [data-part="row-menu"] button { min-height: var(--size-21); padding: var(--space-7); color: var(--nexus-text); background: var(--nexus-surface-raised); border-radius: var(--radius-popup); text-align: start; }
    [data-part="row-menu"] button[role="menuitemradio"][aria-checked="true"] { border: var(--stroke-thin) solid var(--nexus-edge); }
    [data-part="row-menu"] button[aria-disabled="true"] { opacity: 0.5; cursor: not-allowed; }
    [data-part="row-menu"] button[data-destructive] { color: var(--color-warning); }
    [data-part="row-menu-reason"] { margin: 0; padding-inline: var(--space-7); font-size: 0.8em; color: var(--nexus-text); opacity: 0.8; }
</style>
