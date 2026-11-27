<script lang="ts">
    import { onDestroy, onMount, untrack } from 'svelte'
    import { language } from '../../lang'
    import { displayNameOf, folderDeleteCounts, isFolderRow, isLoreRow, type LoreTracked } from '../../ts/studio/edit/loreListModel'
    import { loreAddEntry, loreAlwaysActive, loreFieldEdit, loreTypingKey, type LoreOp } from '../../ts/studio/edit/loreListOps'
    import type { LoreControl, LoreRunEffect } from './StudioLoreList.svelte'
    import { registerStudioField } from '../../ts/studio/fieldFlush'
    import type { OwnerHistoryService, StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import type { OwnerKey } from '../../ts/studio/history/ownerPhase'
    import { createCompositionGate } from '../../ts/studio/toggleBuilderModel'

    // The form of one lorebook folder: its name, its always-active switch (which also sets the entries directly inside),
    // `Add entry in this folder` and Delete. Every write goes through the pane's `runForm` with this form's token, so a
    // name held past the form's life is refused once another view is open.
    interface Props {
        // The token of the open view this form belongs to. It is constant for the instance: the pane keys the form by it.
        token: number
        // The folder's index on the live rows right now.
        index: number
        readLive: () => readonly unknown[]
        editable: boolean
        service: OwnerHistoryService | null
        owner: OwnerKey | null
        runForm: (token: number, make: (t: LoreTracked, hint: number) => LoreOp, effect?: LoreRunEffect, control?: LoreControl) => StudioResult
        deleteOpen: (token: number) => void
        // True when the folder was just added: the Folder name input takes focus (MC-4190).
        focusName?: boolean
    }

    let { token: openToken, index, readLive, editable, service, owner, runForm, deleteOpen, focusName = false }: Props = $props()
    // A prop reads the parent's current value, so a write held past this form's life (the destroy-time flush) would carry the
    // token of whatever view is open by then. The form's own token is captured once.
    const token = untrack(() => openToken)

    const uid = $props.id()
    const rows = $derived(readLive())
    const folder = $derived.by(() => {
        const found: unknown = rows[index]
        return isFolderRow(found) ? found : null
    })
    const name = $derived(typeof folder?.comment === 'string' ? folder.comment : '')
    const counts = $derived(folder === null ? { entries: 0, folders: 0 } : folderDeleteCounts(rows, index))
    const alwaysActive = $derived(isLoreRow(folder) && folder.alwaysActive === true)

    // Each folder is named by its own key, which never changes, so the typing key is the form's token.
    let nameInput = $state<HTMLInputElement | undefined>()
    function commitName(value: string): void {
        const result = runForm(token, (t, hint) => loreFieldEdit(t, hint, 'comment', { had: true, value }, loreTypingKey(`row:${token}`, 'comment')))
        if (!result.ok && nameInput) nameInput.value = name
    }
    const nameGate = createCompositionGate(commitName)

    function closeStep(): void {
        if (owner !== null) service?.closeOpenStep(owner)
    }

    onMount(() => {
        if (focusName) nameInput?.focus()
        return registerStudioField(() => nameGate.flush())
    })
    // A teardown can run before the flush that removes the form, so the late write runs in a microtask: the pane refuses
    // it unless this form's token is still the open one.
    onDestroy(() => {
        const closing = service
        const closingOwner = owner
        queueMicrotask(() => {
            try {
                nameGate.flush()
                if (closingOwner !== null) closing?.closeOpenStep(closingOwner)
            } catch (error) {
                console.error('Studio lore folder form flush failed', error)
            }
        })
    })

    function onAlwaysActive(event: Event & { currentTarget: HTMLInputElement }): void {
        const input = event.currentTarget
        const result = runForm(token, (t, hint) => loreAlwaysActive(t, hint, input.checked))
        if (!result.ok) input.checked = alwaysActive
    }

    function addEntryHere(): void {
        const key = folder?.key
        if (key === undefined) return
        runForm(token, () => loreAddEntry(key), 'opens')
    }

    const inputClass = 'min-h-11 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor'
    const buttonClass = 'min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50'
</script>

{#if folder !== null}
    <section data-part="studio-lore-folder-form" class="mx-auto flex w-full max-w-3xl flex-col gap-3" aria-busy={editable ? undefined : 'true'}>
        <h3 data-part="studio-lore-form-title" class="break-words font-bold">{displayNameOf(folder) ?? language.sidebarUi.unnamedFolder}</h3>
        <div class="flex flex-col gap-1">
            <label for="{uid}-name" class="font-bold">{language.folderName}</label>
            <input
                id="{uid}-name"
                type="text"
                data-part="studio-lore-folder-name"
                class={inputClass}
                readonly={!editable}
                placeholder={language.sidebarUi.unnamedFolder}
                value={name}
                bind:this={nameInput}
                oninput={(event) => nameGate.input(event.currentTarget.value, event instanceof InputEvent && event.isComposing)}
                oncompositionstart={() => nameGate.start()}
                oncompositionend={(event) => nameGate.end(event.currentTarget.value)}
                onblur={() => { nameGate.flush(); closeStep() }}
            />
        </div>
        <p data-part="studio-lore-folder-count" class="text-sm text-textcolor2">{language.studioLoreFolderCount(counts.entries)}</p>
        <label class="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-md border border-darkborderc p-2">
            <span class="min-w-0 flex-1">
                <span class="block font-bold">{language.alwaysActive}</span>
                <span class="block text-sm text-textcolor2">{language.studioLoreFolderAlwaysActive}</span>
            </span>
            <input type="checkbox" role="switch" data-part="studio-lore-folder-always-active" aria-label={language.alwaysActive} disabled={!editable} checked={alwaysActive} onchange={onAlwaysActive} />
        </label>
        <div class="flex flex-wrap gap-2">
            <button type="button" data-part="studio-lore-add-here" class={buttonClass} disabled={!editable} onclick={addEntryHere}>{language.studioLoreAddEntryHere}</button>
            <button type="button" data-part="studio-lore-folder-delete" class="{buttonClass} text-draculared" disabled={!editable} onclick={() => deleteOpen(token)}>{language.studioLoreDelete}</button>
        </div>
    </section>
{/if}
