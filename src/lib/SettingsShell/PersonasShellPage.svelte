<script lang="ts">
    import { onDestroy } from 'svelte'
    import { language } from '../../lang'
    import { afterFlush } from '../../ts/afterFlush'
    import { alertError } from '../../ts/alert'
    import { backCloseHandler, registerBackHandler } from '../../ts/backHandlers'
    import { useCharImageLookups } from '../../ts/media/charImageLookups'
    import { addPersonasFromPng, exportPersona, readPersonaFiles, selectUserImg, type PersonaImportItem } from '../../ts/persona'
    import {
        activatePersona, countBindings, createPersona, duplicatePersona, editPersona, movePersona, nextActiveAfterRemove,
        normalizePersonas, personaRenderKeys, removePersona, type PersonaTextField,
    } from '../../ts/personaList'
    import { personaUndoAction } from '../../ts/setting/personaUndo'
    import { autoscrollDelta, dropIndex, type CardRect } from '../../ts/settingsShell/personaDrag'
    import { setSettingsSubLevel } from '../../ts/settingsShell/settingsNavigation'
    import { isColdStub } from '../../ts/storage/store2/codec/stub'
    import type { RisuPersona } from '../../ts/storage/database.svelte'
    import { DBState } from '../../ts/stores.svelte'
    import { postToast, postUndoToast } from '../../ts/toast/toastHost.svelte'
    import { warnOnReject } from '../../ts/warnOnReject'
    import ShellSheet from '../ChatShell/ShellSheet.svelte'
    import PatternWarning from '../Nexus/pattern/PatternWarning.svelte'
    import type { PatternAnswer, PatternWarningDef } from '../Nexus/pattern/patternWarning'
    import Check from '../UI/GUI/CheckInput.svelte'

    // Establishes the mirror invariant and distinct ids before any card or field reads the list.
    normalizePersonas(DBState.db)

    /** The list sits beside the editor from this width up; below it a chosen card replaces the list. */
    const SPLIT_WIDTH = 1024
    /** The search field appears from this many personas. */
    const SEARCH_FROM = 8

    interface PersonaRow {
        persona: RisuPersona
        index: number
        key: string
    }

    interface DragState {
        id: string
        /** The list index the card lands on if released now. */
        target: number
        x: number
        y: number
    }

    interface DeleteAsk {
        id: string
        lines: string[]
        trigger: HTMLElement | null
    }

    const uid = $props.id()
    const lookups = useCharImageLookups()

    let innerWidth = $state(window.innerWidth)
    let openId = $state<string | null>(null)
    let drilled = $state(false)
    let query = $state('')
    let announcement = $state('')
    let cardMenu = $state<{ id: string, opener: HTMLElement } | null>(null)
    let addMenuOpen = $state(false)
    let deleteAsk = $state<DeleteAsk | null>(null)
    let importItems = $state<PersonaImportItem[] | null>(null)
    let listEl = $state<HTMLElement>()
    let editorEl = $state<HTMLElement>()
    let addButton = $state<HTMLElement>()
    let drag = $state<DragState | null>(null)
    let dragHandle: HTMLElement | null = null
    let dragPointer = -1
    let dragFrame = 0

    const split = $derived(innerWidth >= SPLIT_WIDTH)
    const rows = $derived.by((): PersonaRow[] => {
        const list = DBState.db.personas
        const keys = personaRenderKeys(list)
        return list.map((persona, index) => ({ persona, index, key: keys[index] }))
    })
    const searchable = $derived(rows.length >= SEARCH_FROM)
    const visibleRows = $derived.by((): PersonaRow[] => {
        const needle = query.trim().toLowerCase()
        if (!searchable || needle === '') return rows
        return rows.filter((row) => (row.persona.name ?? '').toLowerCase().includes(needle))
    })
    // A filtered list shows a subset, so a drop position there would not name a list index.
    const draggable = $derived(rows.length > 1 && visibleRows.length === rows.length)
    const bindings = $derived(countBindings(DBState.db.characters))
    // The editor shows the open persona while it exists, otherwise the persona in use.
    const shown = $derived(DBState.db.personas.find((entry) => entry.id === openId) ?? DBState.db.personas[DBState.db.selectedPersona])
    const shownKey = $derived(rows.find((row) => row.persona === shown)?.key ?? null)
    const shownActive = $derived(shown !== undefined && shown === DBState.db.personas[DBState.db.selectedPersona])
    const boundChats = $derived(shown?.id ? listBoundChats(shown.id) : [])
    const menuTarget = $derived(cardMenu ? DBState.db.personas.find((entry) => entry.id === cardMenu?.id) : undefined)
    const menuIndex = $derived(menuTarget ? DBState.db.personas.indexOf(menuTarget) : -1)
    const dialogOpen = $derived(deleteAsk !== null || importItems !== null)

    function listBoundChats(id: string): string[] {
        const found: string[] = []
        for (const slot of DBState.db.characters) {
            if (isColdStub(slot)) continue
            for (const chat of slot.chats ?? []) {
                if (chat.bindedPersona === id) found.push(`${slot.name} · ${chat.name}`)
            }
        }
        return found
    }

    function displayName(persona: RisuPersona): string {
        return persona.name || language.settingsShellPersonaNoName
    }

    function countText(persona: RisuPersona, active: boolean): string {
        const n = bindings.counts.get(persona.id ?? '') ?? 0
        if (active) return bindings.orMore ? language.settingsShellPersonaChatsActiveOrMore(n) : language.settingsShellPersonaChatsActive(n)
        return bindings.orMore ? language.settingsShellPersonaChatsOrMore(n) : language.settingsShellPersonaChats(n)
    }

    function focusCard(key: string): void {
        const buttons = Array.from(listEl?.querySelectorAll<HTMLElement>('[data-persona-open]') ?? [])
        buttons.find((button) => button.getAttribute('data-persona-open') === key)?.focus()
    }

    async function openById(id: string): Promise<void> {
        openId = id
        if (innerWidth < SPLIT_WIDTH) {
            drilled = true
            await afterFlush()
            editorEl?.focus()
        }
    }

    async function closeEditor(): Promise<void> {
        const key = shownKey
        drilled = false
        await afterFlush()
        if (key) focusCard(key)
    }

    // The registration reads the width at call time, so a rotation or resize while drilled in leaves no sub-level at the split width.
    setSettingsSubLevel({ isOpen: () => drilled && innerWidth < SPLIT_WIDTH, close: () => { void closeEditor() } })
    onDestroy(() => setSettingsSubLevel(null))

    $effect(() => {
        if (!dialogOpen) return
        return registerBackHandler(backCloseHandler({
            isOpen: () => deleteAsk !== null || importItems !== null,
            snapshot: () => `${deleteAsk !== null}|${importItems !== null}`,
            close: () => { deleteAsk = null; importItems = null },
        }))
    })

    function edit(field: PersonaTextField, value: string): void {
        if (shown?.id) editPersona(DBState.db, shown.id, field, value)
    }

    function setLarge(value: boolean): void {
        if (shown?.id) editPersona(DBState.db, shown.id, 'largePortrait', value)
    }

    function moveTo(persona: RisuPersona, to: number): void {
        const id = persona.id
        if (!id || to < 0 || to >= DBState.db.personas.length) return
        if (movePersona(DBState.db, id, to)) {
            announcement = language.settingsShellPersonaMoved(displayName(persona), to + 1, DBState.db.personas.length)
        }
    }

    function moveBy(persona: RisuPersona, delta: number): void {
        const from = DBState.db.personas.findIndex((entry) => entry.id === persona.id)
        if (from < 0) return
        moveTo(persona, from + delta)
    }

    function cardRects(): CardRect[] {
        const items = listEl?.querySelectorAll<HTMLElement>('[data-part="settings-persona-card"]') ?? []
        return Array.from(items, (item) => item.getBoundingClientRect())
    }

    /** The nearest scrolling ancestor of the list with its visible band, else the page viewport. */
    function scrollView(): { element: HTMLElement, top: number, bottom: number } {
        for (let node = listEl?.parentElement ?? null; node; node = node.parentElement) {
            const overflow = getComputedStyle(node).overflowY
            if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) {
                const box = node.getBoundingClientRect()
                return { element: node, top: box.top, bottom: box.bottom }
            }
        }
        return { element: document.scrollingElement instanceof HTMLElement ? document.scrollingElement : document.documentElement, top: 0, bottom: window.innerHeight }
    }

    function refreshDropTarget(): void {
        if (!drag) return
        const id = drag.id
        drag.target = dropIndex(drag.y, cardRects(), DBState.db.personas.findIndex((entry) => entry.id === id), drag.x)
    }

    function autoscrollTick(): void {
        dragFrame = 0
        if (!drag) return
        const view = scrollView()
        const delta = autoscrollDelta(drag.y, view.top, view.bottom)
        if (delta !== 0) {
            view.element.scrollTop += delta
            refreshDropTarget()
        }
        dragFrame = requestAnimationFrame(autoscrollTick)
    }

    // Ends a drag without writing; a release writes before calling it.
    function endDrag(): void {
        if (dragFrame) cancelAnimationFrame(dragFrame)
        dragFrame = 0
        const handle = dragHandle
        dragHandle = null
        drag = null
        if (handle?.hasPointerCapture(dragPointer)) handle.releasePointerCapture(dragPointer)
    }

    function onHandleDown(event: PointerEvent, persona: RisuPersona): void {
        const id = persona.id
        if (!id || drag || event.button !== 0) return
        event.preventDefault()
        const handle = event.currentTarget
        if (!(handle instanceof HTMLElement)) return
        handle.setPointerCapture(event.pointerId)
        dragHandle = handle
        dragPointer = event.pointerId
        drag = { id, target: DBState.db.personas.findIndex((entry) => entry.id === id), x: event.clientX, y: event.clientY }
        dragFrame = requestAnimationFrame(autoscrollTick)
    }

    function onHandleMove(event: PointerEvent): void {
        if (!drag || event.pointerId !== dragPointer) return
        drag.x = event.clientX
        drag.y = event.clientY
        refreshDropTarget()
    }

    // The one store write of a drag.
    function onHandleUp(event: PointerEvent): void {
        if (!drag || event.pointerId !== dragPointer) return
        drag.x = event.clientX
        drag.y = event.clientY
        refreshDropTarget()
        const id = drag.id
        const to = drag.target
        endDrag()
        const moved = DBState.db.personas.find((entry) => entry.id === id)
        if (moved) moveTo(moved, to)
    }

    function onHandleCancel(event: PointerEvent): void {
        if (drag && event.pointerId === dragPointer) endDrag()
    }

    function isDropTarget(row: PersonaRow): boolean {
        return drag !== null && drag.id !== row.persona.id && drag.target === row.index
    }

    onDestroy(endDrag)

    // A drag cannot outlive the handle: a filter or a deletion that hides it ends the drag.
    $effect(() => {
        if (drag && !draggable) endDrag()
    })

    function onCardKeydown(event: KeyboardEvent, persona: RisuPersona): void {
        if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
        event.preventDefault()
        event.stopPropagation()
        moveBy(persona, event.key === 'ArrowUp' ? -1 : 1)
    }

    function create(): void {
        addMenuOpen = false
        void openById(createPersona(DBState.db, language.settingsShellPersonaNewName))
    }

    function duplicate(persona: RisuPersona): void {
        if (!persona.id) return
        const id = duplicatePersona(DBState.db, persona.id)
        if (id) void openById(id)
    }

    function exportShown(): void {
        if (!shown) return
        exportPersona({ name: shown.name, personaPrompt: shown.personaPrompt, icon: shown.icon, note: shown.note, largePortrait: shown.largePortrait }).catch(alertError)
    }

    function askDelete(persona: RisuPersona): void {
        const id = persona.id
        if (!id || DBState.db.personas.length <= 1) return
        const next = nextActiveAfterRemove(DBState.db, id)
        if (!next) return
        const bound = bindings.counts.get(id) ?? 0
        const lines = [displayName(persona)]
        if (bound > 0) {
            lines.push(bindings.orMore ? language.settingsShellPersonaBoundQOrMore(bound, displayName(next)) : language.settingsShellPersonaBoundQ(bound, displayName(next)))
        }
        if (persona === DBState.db.personas[DBState.db.selectedPersona]) {
            lines.push(language.settingsShellPersonaNewActive(displayName(next)))
        }
        deleteAsk = { id, lines, trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null }
    }

    function deleteDef(ask: DeleteAsk): PatternWarningDef {
        return {
            severity: 'danger',
            headline: language.settingsShellPersonaDelTitle,
            consequences: ask.lines,
            actions: { cancel: language.cancel, primary: language.settingsShellPersonaDelete },
        }
    }

    function answerDelete(answer: PatternAnswer): void {
        const ask = deleteAsk
        deleteAsk = null
        if (!ask || answer !== 'confirm') return
        const removed = removePersona(DBState.db, ask.id)
        if (removed === null || removed === 'last') return
        openId = null
        postUndoToast({
            text: language.settingsShellPersonaDeleted,
            actionLabel: language.uiCommon.undo,
            action: personaUndoAction(removed.copy, removed.index, removed.wasActive),
        })
        void afterFlush().then(() => editorEl?.focus())
    }

    async function startImport(): Promise<void> {
        addMenuOpen = false
        try {
            const items = await readPersonaFiles()
            if (items.length > 0) importItems = items
        } catch (error) {
            alertError(error)
        }
    }

    function importDef(items: PersonaImportItem[]): PatternWarningDef {
        const ready = items.filter((item) => item.card !== null)
        if (ready.length === 0) {
            return { severity: 'notice', headline: language.settingsShellPersonaImportTitle, consequences: [language.settingsShellPersonaImportBad], actions: { cancel: language.cancel } }
        }
        const lines = items.length === 1 && ready[0].card
            ? [ready[0].card.name || language.settingsShellPersonaNoName, ready[0].card.note].filter((line): line is string => !!line)
            : [language.settingsShellPersonaImportSummary(ready.length, items.length - ready.length)]
        return { severity: 'confirm', headline: language.settingsShellPersonaImportTitle, consequences: lines, actions: { cancel: language.cancel, primary: language.import } }
    }

    async function answerImport(answer: PatternAnswer): Promise<void> {
        const items = importItems
        importItems = null
        if (!items || answer !== 'confirm') return
        try {
            const ids = await addPersonasFromPng(items)
            if (ids.length === 0) return
            postToast({ kind: 'success', text: language.settingsShellPersonaImportDone(ids.length) })
            await openById(ids[0])
        } catch (error) {
            alertError(error)
        }
    }

    function dialogBackground(): HTMLElement[] {
        return [listEl, editorEl, addButton].filter((el): el is HTMLElement => el !== undefined)
    }
</script>

<svelte:window bind:innerWidth />

<div class="flex flex-col gap-3 min-w-0" data-persona-root>
    <div class="flex flex-wrap items-center gap-2" class:hidden={!split && drilled}>
        {#if searchable}
            <input
                type="search"
                class="grow min-w-0 min-h-11 px-3 rounded-md border border-darkborderc bg-transparent text-textcolor focus:border-borderc focus:outline-hidden"
                data-part="settings-search-field"
                aria-label={language.settingsShellPersonaSearch}
                placeholder={language.settingsShellPersonaSearch}
                bind:value={query}
            />
        {/if}
        <button
            type="button"
            class="min-h-11 px-4 rounded-md bg-darkbutton text-textcolor hover:bg-selected"
            aria-haspopup="menu"
            aria-expanded={addMenuOpen}
            bind:this={addButton}
            onclick={() => { addMenuOpen = true }}
        >+ {language.settingsShellPersonaAdd}</button>
        <span class="text-textcolor2 text-sm">{language.settingsShellPersonaCount(rows.length)}</span>
    </div>

    <div class="flex gap-4 min-w-0" class:flex-row={split} class:flex-col={!split}>
        <div class="min-w-0" style:width={split ? '40%' : undefined} class:shrink-0={split} class:hidden={!split && drilled} bind:this={listEl}>
            <ul class="grid gap-2 list-none p-0 m-0" class:grid-cols-1={innerWidth < 768} class:grid-cols-2={innerWidth >= 768} data-part="settings-persona-list">
                {#each visibleRows as row (row.key)}
                    {@const active = row.index === DBState.db.selectedPersona}
                    <li class="flex items-stretch gap-1 rounded-md border bg-darkbg min-w-0" class:border-borderc={row.persona === shown} class:border-darkborderc={row.persona !== shown} class:opacity-60={drag?.id === row.persona.id} class:outline-2={isDropTarget(row)} class:outline-selected={isDropTarget(row)} data-part="settings-persona-card">
                        {#if draggable}
                            <span
                                class="flex shrink-0 items-center justify-center min-w-11 touch-none select-none rounded-md text-textcolor2 hover:text-textcolor"
                                class:cursor-grab={drag === null}
                                class:cursor-grabbing={drag !== null}
                                aria-hidden="true"
                                data-part="settings-persona-handle"
                                onpointerdown={(event) => onHandleDown(event, row.persona)}
                                onpointermove={onHandleMove}
                                onpointerup={onHandleUp}
                                onpointercancel={onHandleCancel}
                                onlostpointercapture={onHandleCancel}
                            >⋮⋮</span>
                        {/if}
                        <button
                            type="button"
                            class="flex grow items-center gap-3 min-w-0 min-h-11 p-2 text-left text-textcolor"
                            data-persona-open={row.key}
                            aria-current={row.persona === shown ? 'true' : undefined}
                            onclick={() => { void openById(row.persona.id ?? '') }}
                            onkeydown={(event) => onCardKeydown(event, row.persona)}
                        >
                            {#if row.persona.icon}
                                {#await warnOnReject('PersonasShellPage: persona icon rejected', lookups.get('persona:' + row.key, row.persona.icon, 'css', { everySize: true }))}
                                    <span class="rounded-md h-14 w-14 shrink-0 bg-textcolor2"></span>
                                {:then im}
                                    <span class="rounded-md h-14 w-14 shrink-0 bg-textcolor2" style={im}></span>
                                {:catch}
                                    <span class="rounded-md h-14 w-14 shrink-0 bg-textcolor2"></span>
                                {/await}
                            {:else}
                                <span class="rounded-md h-14 w-14 shrink-0 bg-textcolor2"></span>
                            {/if}
                            <span class="flex flex-col min-w-0">
                                <span class="font-semibold truncate">{displayName(row.persona)}</span>
                                <span class="text-sm text-textcolor2 truncate">{row.persona.note ?? ''}</span>
                                <span class="text-xs text-textcolor2 truncate" data-part="settings-persona-count">{countText(row.persona, active)}</span>
                            </span>
                            {#if active}
                                <span class="ml-auto shrink-0 px-2 rounded-md bg-selected text-sm" data-part="settings-persona-active">{language.settingsShellPersonaActive}</span>
                            {/if}
                        </button>
                        <button
                            type="button"
                            class="min-h-11 min-w-11 shrink-0 rounded-md text-textcolor2 hover:text-textcolor"
                            aria-haspopup="menu"
                            aria-label={language.settingsShellPersonaActions(displayName(row.persona))}
                            onclick={(event) => { cardMenu = { id: row.persona.id ?? '', opener: event.currentTarget } }}
                        >⋯</button>
                    </li>
                {/each}
            </ul>
        </div>

        <div class="grow min-w-0" class:hidden={!split && !drilled}>
            <div class="flex flex-col gap-3 outline-none rounded-md" tabindex="-1" role="group" aria-label={shown ? displayName(shown) : undefined} bind:this={editorEl} data-part="settings-persona-editor">
                {#if shown}
                    <div class="flex flex-wrap gap-4">
                        <button type="button" class="shrink-0 rounded-md" data-part="settings-persona-portrait" aria-label={language.onboarding.choosePicture} onclick={() => { void selectUserImg(shown.id) }}>
                            {#if shown.icon}
                                {#await warnOnReject('PersonasShellPage: editor icon rejected', lookups.get('persona-editor', shown.icon, shown.largePortrait ? 'lgcss' : 'css'))}
                                    <span class="block rounded-md h-28 w-28 bg-textcolor2"></span>
                                {:then im}
                                    <span class="block rounded-md h-28 w-28 bg-textcolor2" style={im}></span>
                                {:catch}
                                    <span class="block rounded-md h-28 w-28 bg-textcolor2"></span>
                                {/await}
                            {:else}
                                <span class="block rounded-md h-28 w-28 bg-textcolor2"></span>
                            {/if}
                        </button>
                        <div class="flex flex-col grow min-w-0 gap-1">
                            <label class="text-sm text-textcolor2" for="{uid}-name">{language.settingsShellPersonaName}</label>
                            <input id="{uid}-name" type="text" autocomplete="off" class="min-h-11 px-3 rounded-md border border-darkborderc bg-transparent text-textcolor focus:border-borderc focus:outline-hidden" value={shown.name} oninput={(event) => edit('name', event.currentTarget.value)} />
                            <label class="text-sm text-textcolor2" for="{uid}-note">{language.settingsShellPersonaNote}</label>
                            <input id="{uid}-note" type="text" autocomplete="off" class="min-h-11 px-3 rounded-md border border-darkborderc bg-transparent text-textcolor focus:border-borderc focus:outline-hidden" value={shown.note ?? ''} oninput={(event) => edit('note', event.currentTarget.value)} />
                        </div>
                    </div>
                    <label class="text-sm text-textcolor2" for="{uid}-desc">{language.settingsShellPersonaDesc}</label>
                    <textarea id="{uid}-desc" autocomplete="off" class="w-full min-h-40 px-3 py-2 rounded-md border border-darkborderc bg-transparent text-textcolor focus:border-borderc focus:outline-hidden" value={shown.personaPrompt ?? ''} oninput={(event) => edit('personaPrompt', event.currentTarget.value)}></textarea>
                    <span class="text-xs text-textcolor2">{language.settingsShellPersonaDescCount((shown.personaPrompt ?? '').length)}</span>
                    <!-- Function binding: binding an absent flag directly would write `false` into the persona on mount. -->
                    <Check className="min-h-11" label={language.settingsShellPersonaLarge} bind:check={() => shown.largePortrait ?? false, (value) => setLarge(value)}>{language.settingsShellPersonaLarge}</Check>
                    <div class="flex flex-wrap gap-2">
                        <button type="button" class="min-h-11 px-4 rounded-md bg-darkbutton text-textcolor hover:bg-selected disabled:opacity-50" disabled={shownActive} onclick={() => { if (shown.id) activatePersona(DBState.db, shown.id) }}>{shownActive ? language.settingsShellPersonaUsed : language.settingsShellPersonaUse}</button>
                        <button type="button" class="min-h-11 px-4 rounded-md bg-darkbutton text-textcolor hover:bg-selected" onclick={exportShown}>{language.settingsShellPersonaExport}</button>
                        <button type="button" class="min-h-11 px-4 rounded-md bg-darkbutton text-textcolor hover:bg-selected" onclick={() => duplicate(shown)}>{language.settingsShellPersonaDup}</button>
                        <button type="button" class="min-h-11 px-4 rounded-md bg-draculared text-white disabled:opacity-50" disabled={rows.length <= 1} onclick={() => askDelete(shown)}>{language.settingsShellPersonaDelete}</button>
                    </div>
                    {#if rows.length <= 1}
                        <p class="text-sm text-textcolor2" data-part="settings-persona-guard">{language.settingsShellPersonaLast}</p>
                    {/if}
                    <div class="flex flex-col gap-1" data-part="settings-persona-bound">
                        <span class="text-sm text-textcolor2">{boundChats.length > 0 ? language.settingsShellPersonaBoundList : (shownActive ? language.settingsShellPersonaBoundNoneActive : language.settingsShellPersonaBoundNone)}</span>
                        {#each boundChats as chatLine}
                            <span class="text-sm">{chatLine}</span>
                        {/each}
                        <span class="text-xs text-textcolor2">{language.settingsShellPersonaBoundHint}</span>
                    </div>
                {/if}
            </div>
        </div>
    </div>

    <div class="sr-only" role="status" aria-live="polite">{announcement}</div>
</div>

<ShellSheet open={cardMenu !== null} kind="menu" mode="action" label={menuTarget ? language.settingsShellPersonaActions(displayName(menuTarget)) : ''} opener={cardMenu?.opener ?? null} inertOutside onclose={() => { cardMenu = null }}>
    {#if menuTarget}
        <div class="flex flex-col gap-2 p-2">
            {#if DBState.db.personas.indexOf(menuTarget) !== DBState.db.selectedPersona}
                <button type="button" role="menuitem" data-sheet-initial class="min-h-11 px-3 rounded-md text-left bg-darkbutton text-textcolor" onclick={() => { if (menuTarget.id) activatePersona(DBState.db, menuTarget.id); cardMenu = null }}>{language.settingsShellPersonaUse}</button>
            {/if}
            <button type="button" role="menuitem" class="min-h-11 px-3 rounded-md text-left bg-darkbutton text-textcolor" aria-disabled={menuIndex <= 0 ? 'true' : undefined} onclick={() => { if (menuIndex > 0) { moveBy(menuTarget, -1); cardMenu = null } }}>{language.settingsShellPersonaUp}</button>
            <button type="button" role="menuitem" class="min-h-11 px-3 rounded-md text-left bg-darkbutton text-textcolor" aria-disabled={menuIndex >= rows.length - 1 ? 'true' : undefined} onclick={() => { if (menuIndex < rows.length - 1) { moveBy(menuTarget, 1); cardMenu = null } }}>{language.settingsShellPersonaDown}</button>
            <button type="button" role="menuitem" class="min-h-11 px-3 rounded-md text-left bg-darkbutton text-textcolor" onclick={() => { duplicate(menuTarget); cardMenu = null }}>{language.settingsShellPersonaDup}</button>
        </div>
    {/if}
</ShellSheet>

<ShellSheet open={addMenuOpen} kind="menu" mode="action" label={language.settingsShellPersonaAdd} opener={addButton ?? null} inertOutside onclose={() => { addMenuOpen = false }}>
    <div class="flex flex-col gap-2 p-2">
        <button type="button" role="menuitem" data-sheet-initial class="min-h-11 px-3 rounded-md text-left bg-darkbutton text-textcolor" onclick={create}>{language.settingsShellPersonaNew}</button>
        <button type="button" role="menuitem" class="min-h-11 px-3 rounded-md text-left bg-darkbutton text-textcolor" onclick={() => { void startImport() }}>{language.settingsShellPersonaImportMenu}</button>
    </div>
</ShellSheet>

{#if deleteAsk}
    <PatternWarning def={deleteDef(deleteAsk)} trigger={deleteAsk.trigger} background={dialogBackground()} onanswer={answerDelete} />
{/if}
{#if importItems}
    <PatternWarning def={importDef(importItems)} background={dialogBackground()} onanswer={(answer) => { void answerImport(answer) }} />
{/if}
