<script lang="ts">
    import { onDestroy, tick, untrack } from 'svelte'
    import { afterFlush } from '../../ts/afterFlush'
    import { language } from '../../lang'
    import { DBState, additionalChatMenu, hypaV3ModalOpen, settingsOpen } from '../../ts/stores.svelte'
    import type { Chat, character, groupChat } from '../../ts/storage/database.svelte'
    import { alertError, showHypaV2Alert } from '../../ts/alert'
    import { openStudio } from '../../ts/studio/studioScreen.svelte'
    import { studioEligible } from '../../ts/studio/studioSwitch.svelte'
    import { exportChat, removeChatConfirmed } from '../../ts/characters'
    import { effectiveJailbreak, effectiveMemory, writeChatJailbreak, writeChatMemory } from '../../ts/parser/chatToggleScope'
    import { chatStats, normalizeChatName, promptHasJailbreakToggle, relativeTime, setChatHideNames, writeChatName, writeChatNote } from '../../ts/chatShell/thisChatEdits'
    import { isImeComposing } from '../../ts/ime/compositionGuard'
    import PluginDefinedIcon from '../Others/PluginDefinedIcon.svelte'
    import ShellSheet from './ShellSheet.svelte'
    import ToggleScopeSwitch from './ToggleScopeSwitch.svelte'

    /**
     * The sheet of the chat on screen: title and rename, persona, author note, modules, hide names, the chat-only
     * scope switch, memory and jailbreak, settings, plugin rows, export and delete.
     *
     * It works on the owner and chat captured when it opens (`target`); ChatShell closes it when the shown chat
     * changes. The note autosave, every note flush and the rename commit run after user time has passed, so they
     * write through `thisChatEdits` (the live owner and chat, found again, with a save mark) and a refusal is shown
     * through the error alert and never as "Saved". Rows that leave the sheet (export, memory view, modules, all
     * settings, plugin rows) close it first and act afterwards, so the alert or panel they open is not under the sheet.
     * The delete confirm is ChatShell's: the sheet only passes `confirmDelete` to `removeChatConfirmed`.
     */
    interface Props {
        open: boolean
        opener: HTMLElement | null
        background: readonly HTMLElement[]
        target: { owner: character | groupChat, chat: Chat } | null
        layer?: HTMLElement
        confirmDelete: (request: { chat: Chat, busy: boolean }, trigger: HTMLElement | null) => Promise<boolean>
        onpersona: (opener: HTMLElement) => void
        // The summary row of the toggles panel: absent unless the shell can open the panel.
        togglesSummary?: () => string | null
        ontoggles?: (opener: HTMLElement) => void
        onmodules: () => void
        // The jump sheet: absent unless the shell can open it. It opens after this sheet has closed, on the opener this sheet had.
        onjumpsheet?: (opener: HTMLElement | null) => void
        onremoved: () => void
        onclose: () => void
    }

    let { open, opener, background, target, layer = $bindable(), confirmDelete, onpersona, togglesSummary, ontoggles, onmodules, onjumpsheet, onremoved, onclose }: Props = $props()

    const NOTE_IDLE_MS = 600
    const SAVED_SHOWN_MS = 2000

    type Session = { owner: character | groupChat, chat: Chat }

    // Known from the first render of an opening, so the title exists when the sheet takes its initial focus.
    let session: Session | null = $derived(open ? target : null)
    // Bumped after a write, so rows that read the chat show it even when the chat object is not reactive.
    let edits = $state(0)
    let shownName = $state('')
    let noteText = $state('')
    let renaming = $state(false)
    let nameDraft = $state('')
    let saved = $state(false)
    let noteEl = $state<HTMLTextAreaElement>()
    let nameEl = $state<HTMLInputElement>()
    let renameEl = $state<HTMLButtonElement>()
    let deleteEl = $state<HTMLButtonElement>()
    // What is being edited lives in plain variables as well: the cleanup below runs in the flush that closes the sheet,
    // which may not yet see a value a field handler has just written to `$state`, and a pending edit must not be lost.
    let noteDirty = false
    let noteDraft = ''
    let renameActive = false
    let nameValue = ''
    let lastName = ''
    let noteTimer: ReturnType<typeof setTimeout> | undefined
    let savedTimer: ReturnType<typeof setTimeout> | undefined

    // One opening is one session. Closing, switching chat and destroying the sheet all run the cleanup, which flushes
    // what is pending to the chat that was open while its fields are still on screen.
    $effect.pre(() => {
        if (!open) return
        const opened = untrack(() => target)
        if (!opened) return
        // Read once per opening: a note or name that changes while the sheet is open must not restart the session.
        const { name, note } = untrack(() => ({ name: opened.chat.name, note: opened.chat.note ?? '' }))
        lastName = name
        shownName = name
        noteDraft = note
        noteText = note
        noteDirty = false
        renameActive = false
        renaming = false
        nameDraft = ''
        return () => {
            flushPending(opened)
            clearTimeout(noteTimer)
        }
    })

    onDestroy(() => {
        clearTimeout(noteTimer)
        clearTimeout(savedTimer)
    })

    function showSaved(): void {
        saved = true
        clearTimeout(savedTimer)
        savedTimer = setTimeout(() => { saved = false }, SAVED_SHOWN_MS)
    }

    function refused(): void {
        alertError(language.chatShellEditNotSaved)
    }

    function targetOf(at: Session): { chaId: string, chat: Chat } {
        return { chaId: at.owner.chaId, chat: at.chat }
    }

    function flushNote(at: Session): void {
        clearTimeout(noteTimer)
        if (!noteDirty) return
        noteDirty = false
        if (writeChatNote(targetOf(at), noteDraft)) {
            showSaved()
        } else {
            refused()
        }
    }

    function commitRename(at: Session, refocus: boolean): void {
        if (!renameActive) return
        renameActive = false
        renaming = false
        const name = normalizeChatName(nameValue)
        if (name !== null && name !== lastName) {
            if (writeChatName(targetOf(at), name)) {
                lastName = name
                shownName = name
                edits++
                showSaved()
            } else {
                refused()
            }
        }
        if (refocus) void afterFlush().then(() => renameEl?.focus())
    }

    function flushPending(at: Session): void {
        commitRename(at, false)
        flushNote(at)
    }

    function onNoteInput(event: Event & { currentTarget: HTMLTextAreaElement }): void {
        noteDraft = event.currentTarget.value
        noteDirty = true
        clearTimeout(noteTimer)
        noteTimer = setTimeout(() => {
            if (session) flushNote(session)
        }, NOTE_IDLE_MS)
    }

    async function startRename(): Promise<void> {
        if (!session) return
        nameValue = lastName
        nameDraft = lastName
        renameActive = true
        renaming = true
        await afterFlush()
        nameEl?.focus()
        nameEl?.select()
    }

    function cancelRename(): void {
        renameActive = false
        renaming = false
        void afterFlush().then(() => renameEl?.focus())
    }

    function onNameKey(event: KeyboardEvent): void {
        if (event.key === 'Enter' && !isImeComposing(event) && session) {
            event.preventDefault()
            commitRename(session, true)
        }
    }

    // Escape goes to the field being edited first: it reverts a rename or leaves the note, and the sheet stays.
    function innerEscape(): boolean {
        if (renameActive) {
            cancelRename()
            return true
        }
        if (noteEl && document.activeElement === noteEl) {
            noteEl.blur()
            return true
        }
        return false
    }

    // The sheet closes first, the action runs after the close has been flushed.
    function leave(action: () => void): void {
        onclose()
        void tick().then(action)
    }

    // Studio opens on the character's basic info after the sheet has closed; Back returns focus to whatever opened the sheet.
    function openInStudio(): void {
        if (!session) return
        const chaId = session.owner.chaId
        const origin = opener
        leave(() => { openStudio({ owner: { type: 'character', id: chaId }, kind: 'basic', from: 'chat' }, { element: origin }) })
    }

    let stats = $derived.by(() => {
        void edits
        if (!session) return ''
        const { count, lastTime } = chatStats(session.chat)
        return language.chatShellChatStats(count, lastTime === undefined ? '' : relativeTime(lastTime, Date.now()))
    })
    let personaName = $derived.by(() => {
        void edits
        const personas = DBState.db.personas ?? []
        const bound = session?.chat.bindedPersona
        const persona = bound ? personas.find((entry) => entry.id === bound) : personas[DBState.db.selectedPersona]
        return persona?.name ?? DBState.db.username
    })
    let moduleCount = $derived.by(() => {
        void edits
        return session?.chat.modules?.length ?? 0
    })
    let hideNamesOn = $derived.by(() => {
        void edits
        return session?.chat.hideNames === true
    })
    let jailbreakOn = $derived.by(() => {
        void edits
        return effectiveJailbreak(session?.chat)
    })
    let memoryOn = $derived.by(() => {
        void edits
        return session ? effectiveMemory(session.owner, session.chat) : false
    })
    let togglesText = $derived.by(() => {
        void edits
        return session ? togglesSummary?.() ?? '' : ''
    })
    let soleChat = $derived.by(() => {
        void edits
        return (session?.owner.chats.length ?? 0) <= 1
    })
    // The chat-only scope moves the jailbreak and memory rows into the first group; the same predicate as the toggles panel.
    let scopeOn = $derived.by(() => {
        void edits
        return session?.chat.useLocallySetGlobalVariables === true
    })
    let showJailbreak = $derived(promptHasJailbreakToggle(DBState.db))
    let showMemory = $derived(DBState.db.supaModelType !== 'none' || !!DBState.db.hanuraiEnable || !!DBState.db.hypav2 || !!DBState.db.hypaV3)
    let memoryLabel = $derived(DBState.db.hanuraiEnable ? language.hanuraiMemory : (DBState.db.hypav2 || DBState.db.hypaV3 || DBState.db.hypaMemory) ? language.ToggleHypaMemory : language.ToggleSuperMemory)
    let showMemoryView = $derived(!!DBState.db.showMenuHypaMemoryModal && ((DBState.db.supaModelType !== 'none' && !!DBState.db.hypav2) || !!DBState.db.hypaV3))

    function setHideNames(value: boolean): void {
        if (!session) return
        setChatHideNames(targetOf(session), value)
        edits++
        showSaved()
    }

    function setJailbreak(value: boolean): void {
        if (!session) return
        writeChatJailbreak(session.owner, session.chat, value)
        edits++
        showSaved()
    }

    function setMemory(value: boolean): void {
        if (!session) return
        writeChatMemory(session.owner, session.chat, value)
        edits++
        showSaved()
    }

    function openModules(): void {
        const at = session
        if (!at) return
        leave(() => {
            at.chat.modules ??= []
            onmodules()
        })
    }

    function openMemoryView(): void {
        const at = session
        if (!at) return
        leave(() => {
            if (DBState.db.hypav2) {
                at.chat.hypaV2Data ??= { lastMainChunkID: 0, mainChunks: [], chunks: [] }
                showHypaV2Alert()
            } else if (DBState.db.hypaV3) {
                hypaV3ModalOpen.set(true)
            }
        })
    }

    function exportThisChat(): void {
        const at = session
        if (!at) return
        const page = at.owner.chats.indexOf(at.chat)
        if (page === -1) return
        leave(() => { void exportChat(page) })
    }

    async function deleteChat(): Promise<void> {
        const at = session
        if (!at || soleChat) return
        // What is typed is saved while the chat still exists; nothing is pending once the confirm is open.
        flushPending(at)
        const removed = await removeChatConfirmed(at.owner, at.chat, (request) => confirmDelete(request, deleteEl ?? null))
        if (removed) onremoved()
    }
</script>

{#snippet jailbreakRow()}
    {#if showJailbreak}
        <label data-part="this-chat-row">
            <span>{language.jailbreakToggle}</span>
            <input type="checkbox" role="switch" data-part="this-chat-jailbreak" checked={jailbreakOn} onchange={(event) => setJailbreak(event.currentTarget.checked)} />
        </label>
    {/if}
{/snippet}

{#snippet memoryRows()}
    {#if showMemory}
        <label data-part="this-chat-row">
            <span>{memoryLabel}</span>
            <input type="checkbox" role="switch" data-part="this-chat-memory" checked={memoryOn} onchange={(event) => setMemory(event.currentTarget.checked)} />
        </label>
        {#if showMemoryView}
            <button type="button" data-part="this-chat-memory-view" data-kind="button" onclick={openMemoryView}>{DBState.db.hypav2 ? language.hypaMemoryV2Modal : language.hypaMemoryV3Modal}</button>
        {/if}
    {/if}
{/snippet}

<ShellSheet {open} kind="sheet" mode="side" label={language.chatShellThisChat} {opener} {background} innerescape={innerEscape} bind:layer {onclose}>
    {#if session}
        <div data-part="this-chat-body">
            <div data-part="this-chat-title-block">
                {#if renaming}
                    <input bind:this={nameEl} data-part="this-chat-name-input" aria-label={language.chatShellRename} value={nameDraft} oninput={(event) => { nameValue = event.currentTarget.value }} onkeydown={onNameKey} onblur={() => { if (session) commitRename(session, false) }} />
                {:else}
                    <h2 tabindex="-1" data-sheet-initial data-part="this-chat-title">{shownName}</h2>
                    <button bind:this={renameEl} type="button" data-part="this-chat-rename" data-kind="button" onclick={startRename}>{language.chatShellRename}</button>
                {/if}
            </div>
            <p data-part="this-chat-stats">{stats}</p>
            <p role="status" data-part="this-chat-status">{saved ? language.chatShellSaved : ''}</p>

            {#if onjumpsheet}
                <section data-part="this-chat-group" aria-label={language.chatShellJumpSheet}>
                    <button type="button" data-part="this-chat-jump" data-kind="button" aria-haspopup="dialog" onclick={() => leave(() => onjumpsheet(opener))}>{language.chatShellJumpSheet}</button>
                </section>
            {/if}

            <section data-part="this-chat-group" aria-label={language.chatShellThisChat}>
                <button type="button" data-part="this-chat-persona" data-kind="button" aria-haspopup="dialog" onclick={(event) => onpersona(event.currentTarget)}>
                    <span>{language.chatShellChoosePersona}</span>
                    <span data-part="this-chat-value">{personaName}</span>
                </button>
                <label data-part="this-chat-field">
                    <span>{language.authorNote}</span>
                    <textarea bind:this={noteEl} data-part="this-chat-note" rows="4" value={noteText} oninput={onNoteInput} onblur={() => { if (session) flushNote(session) }}></textarea>
                </label>
                <button type="button" data-part="this-chat-modules" data-kind="button" onclick={openModules}>
                    <span>{language.modules}</span>
                    <span data-part="this-chat-value">{moduleCount}</span>
                </button>
                {#if studioEligible()}
                    <button type="button" data-part="this-chat-studio" data-kind="button" onclick={openInStudio}>{language.studioOpenIn}</button>
                {/if}
                <label data-part="this-chat-row">
                    <span>{language.chatShellHideNames}</span>
                    <input type="checkbox" role="switch" data-part="this-chat-hide-names" checked={hideNamesOn} onchange={(event) => setHideNames(event.currentTarget.checked)} />
                </label>
                <!-- A flip or an Undo bubbles here, so the placement below is read again even when the chat object is not reactive. -->
                <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
                <div class="scope-host" onchange={() => { edits++ }} onclick={() => { edits++ }}>
                    <ToggleScopeSwitch owner={session.owner} chat={session.chat} effective={() => ({ jailbreak: effectiveJailbreak(session?.chat), memory: session ? effectiveMemory(session.owner, session.chat) : false })} />
                </div>
                {#if scopeOn}
                    {@render jailbreakRow()}
                    {@render memoryRows()}
                {/if}
                {#if ontoggles}
                    <button type="button" data-part="this-chat-toggles" data-kind="button" aria-haspopup="dialog" onclick={(event) => ontoggles(event.currentTarget)}>
                        <span>{language.chatShellTogglesTitle}</span>
                        <span data-part="this-chat-value">{togglesText}</span>
                    </button>
                {/if}
            </section>

            {#if showMemory && !scopeOn}
                <section data-part="this-chat-group" aria-labelledby="this-chat-scope-character">
                    <span id="this-chat-scope-character" data-part="this-chat-scope-tag">{language.chatShellScopeCharacter}</span>
                    {@render memoryRows()}
                </section>
            {/if}

            <section data-part="this-chat-group" aria-labelledby="this-chat-scope-all">
                <span id="this-chat-scope-all" data-part="this-chat-scope-tag">{language.chatShellScopeAll}</span>
                {#if !scopeOn}
                    {@render jailbreakRow()}
                {/if}
                <button type="button" data-part="this-chat-all-settings" data-kind="button" onclick={() => leave(() => settingsOpen.set(true))}>{language.chatShellAllSettings}</button>
            </section>

            {#if additionalChatMenu.length > 0}
                <section data-part="this-chat-group" aria-label={language.chatShellMoreActions}>
                    {#each additionalChatMenu as menu (menu.id)}
                        <button type="button" data-part="this-chat-plugin" data-kind="button" onclick={() => leave(menu.callback)}><PluginDefinedIcon ico={menu} />{menu.name}</button>
                    {/each}
                </section>
            {/if}

            <section data-part="this-chat-group" data-destructive-group aria-label={language.chatShellMoreActions}>
                <button type="button" data-part="this-chat-export" data-kind="button" onclick={exportThisChat}>{language.chatShellExportChat}</button>
                <button bind:this={deleteEl} type="button" data-part="this-chat-delete" data-kind="button" data-destructive aria-disabled={soleChat ? 'true' : undefined} aria-describedby={soleChat ? 'this-chat-delete-reason' : undefined} onclick={deleteChat}>{language.chatShellDeleteChat}</button>
                {#if soleChat}
                    <p id="this-chat-delete-reason" data-part="this-chat-delete-reason">{language.errors.onlyOneChat}</p>
                {/if}
            </section>
        </div>
    {/if}
</ShellSheet>

<style>
    [data-part="this-chat-body"] { display: flex; flex-direction: column; gap: var(--space-7); }
    [data-part="this-chat-title-block"] { display: flex; align-items: center; gap: var(--space-7); position: sticky; top: 0; background: var(--color-surface-sheet); }
    [data-part="this-chat-title"] { flex: 1; min-width: 0; margin: 0; font-size: var(--font-size-xl); overflow-wrap: anywhere; }
    [data-part="this-chat-title"]:focus-visible { outline: var(--stroke-bold) solid var(--nexus-text); }
    [data-part="this-chat-name-input"] { flex: 1; min-width: 0; min-height: var(--size-touch); padding: 0 var(--space-7); color: var(--nexus-text); background: var(--nexus-surface-raised); border: 1px solid var(--nexus-edge); border-radius: var(--radius-control); font-size: var(--font-size-xl); }
    [data-part="this-chat-stats"] { margin: 0; font-size: var(--font-size-sm); color: var(--nexus-text-secondary); }
    [data-part="this-chat-status"] { margin: 0; min-height: var(--space-12); font-size: var(--font-size-xs); color: var(--nexus-text-secondary); }
    [data-part="this-chat-group"] { display: flex; flex-direction: column; border-top: 1px solid var(--nexus-edge); padding-top: var(--space-5); }
    .scope-host { display: contents; }
    [data-part="this-chat-scope-tag"] { align-self: flex-start; margin: var(--space-3) 0; padding: 0 var(--space-5); font-size: var(--font-size-xs); color: var(--nexus-text-secondary); border: 1px solid var(--nexus-edge); border-radius: var(--radius-pill); }
    [data-part="this-chat-group"] button[data-kind="button"], [data-part="this-chat-row"] { display: flex; align-items: center; justify-content: space-between; gap: var(--space-7); width: 100%; min-height: var(--size-touch); padding: var(--space-5) var(--space-10); text-align: left; color: var(--nexus-text); border-bottom: 1px solid var(--nexus-edge); }
    [data-part="this-chat-rename"] { flex: none; min-height: var(--size-touch); padding: 0 var(--space-7); color: var(--nexus-text); border: 1px solid var(--nexus-edge); border-radius: var(--radius-control); }
    [data-part="this-chat-value"] { color: var(--nexus-text-secondary); }
    [data-part="this-chat-field"] { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-5) var(--space-10); }
    [data-part="this-chat-note"] { width: 100%; resize: vertical; padding: var(--space-7); color: var(--nexus-text); background: var(--nexus-surface-raised); border: 1px solid var(--nexus-edge); border-radius: var(--radius-control); }
    [data-part="this-chat-group"] :is(button, textarea, input):focus-visible { outline: var(--stroke-bold) solid var(--nexus-text); }
    [data-part="this-chat-delete"][aria-disabled="true"] { opacity: var(--opacity-half); cursor: not-allowed; }
    [data-part="this-chat-delete-reason"] { margin: 0; padding: var(--space-5) var(--space-10); font-size: var(--font-size-xs); color: var(--nexus-text-secondary); }
</style>
