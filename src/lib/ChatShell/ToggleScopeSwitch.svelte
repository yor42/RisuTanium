<script lang="ts">
    import { onDestroy } from 'svelte'
    import { language } from 'src/lang'
    import { DBState } from 'src/ts/stores.svelte'
    import type { Chat } from 'src/ts/storage/database.svelte'
    import {
        currentScopeKeys,
        disableChatScope,
        enableChatScope,
        restoreChatScope,
        type ChatScopeSnapshot,
        type EffectiveSwitches,
        type ScopeOwner,
        type ScopeTarget,
    } from 'src/ts/parser/chatToggleScope'

    /**
     * The chat-only scope switch. On copies the current shared toggle values into the chat; off discards the chat's
     * own values and offers an Undo for `undoMs` (6 s in the sheet, 10 s in the panel). The Undo writes through the
     * live owner and chat and is refused, with a notice, when the chat changed or was closed or archived meanwhile.
     * Focus stays on the switch across a flip and an Undo.
     */
    interface Props {
        owner: ScopeOwner
        chat: Chat
        undoMs?: number
        // The jailbreak and memory values in force, read when the scope turns on so the chat starts from them.
        effective?: () => EffectiveSwitches
    }

    let { owner, chat, undoMs = 6000, effective }: Props = $props()

    const instanceId = $props.id()
    const noteId = `toggle-scope-note-${instanceId}`

    type Row = 'none' | 'undo' | 'refused'

    let scoped = $state(false)
    let row = $state<Row>('none')
    let switchEl: HTMLInputElement | undefined = $state()
    let snapshot: ChatScopeSnapshot | undefined
    let discardedFrom: ScopeTarget | undefined
    let timer: ReturnType<typeof setTimeout> | undefined

    $effect(() => {
        scoped = chat.useLocallySetGlobalVariables === true
    })

    onDestroy(() => clearTimeout(timer))

    function closeRow() {
        clearTimeout(timer)
        timer = undefined
        row = 'none'
        snapshot = undefined
        discardedFrom = undefined
    }

    function flip() {
        const target: ScopeTarget = { chaId: owner.chaId, chat }
        if (scoped) {
            const taken = disableChatScope(target)
            if (taken) {
                closeRow()
                snapshot = taken
                discardedFrom = target
                row = 'undo'
                timer = setTimeout(closeRow, undoMs)
            }
        } else {
            closeRow()
            enableChatScope(target, currentScopeKeys(owner), DBState.db.globalChatVariables, effective?.())
        }
        scoped = chat.useLocallySetGlobalVariables === true
        if (switchEl) {
            switchEl.checked = scoped
        }
    }

    function undo() {
        if (!snapshot || !discardedFrom) {
            return
        }
        if (restoreChatScope(discardedFrom, snapshot)) {
            closeRow()
            scoped = true
        } else {
            // The row time keeps running; the refusal replaces the Undo for the rest of it.
            snapshot = undefined
            discardedFrom = undefined
            row = 'refused'
        }
        if (switchEl) {
            switchEl.checked = scoped
            switchEl.focus({ preventScroll: true })
        }
    }
</script>

<div class="flex flex-col gap-1 w-full" data-part="toggle-scope-switch">
    <label class="relative flex items-center gap-2 cursor-pointer text-textcolor min-h-11">
        <input
            bind:this={switchEl}
            class="sr-only peer"
            type="checkbox"
            role="switch"
            checked={scoped}
            aria-describedby={noteId}
            onchange={flip}
        />
        <span
            class="relative w-9 h-5 min-w-9 rounded-full border-2 border-darkborderc transition-colors duration-200 peer-focus-visible:ring-2 peer-focus-visible:ring-textcolor2 {scoped ? 'bg-darkborderc' : 'bg-darkbutton'}"
            aria-hidden="true"
        >
            <span class="absolute top-0 w-4 h-4 rounded-full bg-textcolor transition-all duration-200 {scoped ? 'left-4' : 'left-0'}"></span>
        </span>
        <span>{language.chatShellToggleScopeLabel}</span>
    </label>
    <p id={noteId} class="text-xs text-textcolor2">
        {scoped ? language.chatShellToggleScopeNoteOn : language.chatShellToggleScopeNoteOff}
        {#if scoped}{language.chatShellToggleScopeInherit}{/if}
    </p>
    <div role="status" class="text-sm text-textcolor2">
        {#if row === 'undo'}
            <span>{language.chatShellTogglesDiscarded}</span>
            <button type="button" class="ml-2 min-h-11 px-2 underline text-textcolor" onclick={undo}>{language.chatShellToggleScopeUndo}</button>
        {:else if row === 'refused'}
            <span>{language.chatShellToggleScopeUndoRefused}</span>
        {/if}
    </div>
</div>
