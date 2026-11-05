<script lang="ts">
    import { onDestroy } from 'svelte'
    import { v4 } from 'uuid'
    import { DBState, popUpEditorStore, selIdState } from '../../ts/stores.svelte'
    import { doingChat, chatProcessStage } from '../../ts/process/index.svelte'
    import { sendMain, abortChat, isComposerBusy, isComposerLocked, reroll, updateInputTransateMessage, type ComposerActionsSource } from '../../ts/process/composerActions.svelte'
    import { createComposerSurface, beginChatFileUpload, trackChatFileUpload } from '../../ts/process/composerSurface.svelte'
    import * as composerDrafts from '../../ts/process/composerDrafts.svelte'
    import { COMPOSER_DRAFT_KIND, registerDraft, unregisterDraft } from '../../ts/localDrafts'
    import { postChatFile } from '../../ts/process/files/multisend'
    import type { OriginHint } from '../../ts/process/chatOrigin'
    import { language } from '../../lang'
    import Suggestion from '../ChatScreens/Suggestion.svelte'
    import ExtrasStrip from './ExtrasStrip.svelte'
    import { createEnterKeyController } from '../../ts/chatShell/enterKey'
    import { readEnterMode, writeEnterMode, type EnterMode } from '../../ts/chatShell/deviceSettings'

    interface Props {
        onplus: (opener: HTMLElement) => void
        onpersona: (opener: HTMLElement) => void
        onhardwarechange?: (seen: boolean) => void
        stickersOpen?: boolean
    }

    let { onplus, onpersona, onhardwarechange, stickersOpen = $bindable(false) }: Props = $props()
    let character = $derived(DBState.db.characters[selIdState.selId])
    let chat = $derived(character?.chats?.[character.chatPage])
    let personaName = $derived.by(() => {
        const bound = DBState.db.personas?.find((persona) => persona?.id === chat?.bindedPersona)
        return bound?.name ?? DBState.db.personas?.[DBState.db.selectedPersona]?.name ?? DBState.db.username
    })
    const surface = createComposerSurface({ character: () => character, chat: () => chat })
    let shownDraft = $derived(surface.shownDraft)
    let enterMode: EnterMode = $state(readEnterMode(DBState.db.sendWithEnter))
    const enter = createEnterKeyController()
    const source: ComposerActionsSource = { closeMenu: () => {} }
    const composerDraftKey = v4()
    let input = $state<HTMLTextAreaElement>()
    let translateInput = $state<HTMLTextAreaElement>()
    let popupTimer: ReturnType<typeof setInterval> | null = null

    function selectSticker(asset: [string, string, string]): void {
        if (isComposerLocked()) return
        let fileType = 'img'
        if (asset[2] === 'mp4' || asset[2] === 'webm') fileType = 'video'
        else if (asset[2] === 'mp3' || asset[2] === 'wav') fileType = 'audio'
        surface.writeDraft((record) => { record.messageInput += `<span class='notranslate' translate='no'>{{${fileType}::${asset[0]}}}</span> *${asset[0]} added*` })
    }

    // A nonempty on-screen record must block reload until its owning composer is destroyed.
    $effect(() => {
        if (shownDraft.messageInput !== '' || shownDraft.messageInputTranslate !== '' || shownDraft.fileInput.length > 0) {
            registerDraft(composerDraftKey, COMPOSER_DRAFT_KIND)
            return () => unregisterDraft(composerDraftKey)
        }
    })
    onDestroy(() => {
        unregisterDraft(composerDraftKey)
        if (popupTimer !== null) clearInterval(popupTimer)
    })

    $effect(() => {
        void shownDraft.messageInput
        void shownDraft.messageInputTranslate
        for (const field of [input, translateInput]) {
            if (!field || field.offsetParent === null) continue
            field.style.height = '0'
            field.style.height = `${field.scrollHeight}px`
        }
    })

    $effect(() => {
        const viewport = window.visualViewport
        if (!viewport) return
        const changed = () => {
            enter.observeViewport(viewport.height, document.activeElement === input || document.activeElement === translateInput)
            onhardwarechange?.(enter.hardwareSeen)
        }
        changed()
        viewport.addEventListener('resize', changed)
        return () => viewport.removeEventListener('resize', changed)
    })

    $effect(() => {
        const touched = (event: PointerEvent) => {
            if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return
            enter.touch()
            onhardwarechange?.(false)
        }
        document.addEventListener('pointerdown', touched)
        return () => document.removeEventListener('pointerdown', touched)
    })

    function originHint(): OriginHint | null {
        return character && chat ? { owner: character, chat } : null
    }

    function appendResults(results: Awaited<ReturnType<typeof postChatFile>>, key: composerDrafts.ComposerDraftKey | null): void {
        if (!results) return
        surface.writeDraftAt(key, (record) => {
            for (const result of results) {
                if (result?.type === 'asset') record.fileInput.push(result.data)
                if (result?.type === 'text') record.messageInput += `{{file::${result.name}::${result.data}}}`
            }
        })
    }

    function paste(event: ClipboardEvent): void {
        if (isComposerLocked()) return
        const items = event.clipboardData?.items
        if (!items) return
        for (const item of items) {
            if (item.kind !== 'file' || !item.type.startsWith('image')) continue
            const file = item.getAsFile()
            if (!file) continue
            event.preventDefault()
            const key = surface.resolveDraftKeyForWrite()
            const hint = originHint()
            const reader = new FileReader()
            const settle = beginChatFileUpload()
            reader.onload = async () => {
                try {
                    if (reader.result instanceof ArrayBuffer) {
                        appendResults(await postChatFile({ name: file.name, data: new Uint8Array(reader.result) }, key, hint), key)
                    }
                } finally {
                    settle()
                }
            }
            reader.onerror = settle
            reader.onabort = settle
            try { reader.readAsArrayBuffer(file) }
            catch (error) { settle(); throw error }
        }
    }

    async function postFile(): Promise<void> {
        if (isComposerLocked()) return
        const key = surface.resolveDraftKeyForWrite()
        const hint = originHint()
        appendResults(await trackChatFileUpload(() => postChatFile(composerDrafts.peek(key).messageInput, key, hint)), key)
    }

    function keydown(event: KeyboardEvent): void {
        enter.observeKey(event)
        onhardwarechange?.(enter.hardwareSeen)
        if (event.key.toLowerCase() === 'm' && event.ctrlKey && !event.isComposing && event.keyCode !== 229) {
            event.preventDefault()
            void reroll(source)
            return
        }
        if (enter.shouldSend(event, enterMode)) {
            event.preventDefault()
            void sendMain(source, false)
        }
    }

    function openPopup(event: MouseEvent): void {
        if (!DBState.db.longPressToPopupEditor || isComposerLocked()) return
        event.preventDefault()
        popUpEditorStore.value = shownDraft.messageInput
        popUpEditorStore.mode = 'default'
        popUpEditorStore.language = ''
        popUpEditorStore.open = true
        if (popupTimer !== null) clearInterval(popupTimer)
        popupTimer = setInterval(() => {
            if (popUpEditorStore.open) return
            surface.writeDraft((record) => { record.messageInput = popUpEditorStore.value })
            if (popupTimer !== null) clearInterval(popupTimer)
            popupTimer = null
        }, 100)
    }

    function setMode(event: Event): void {
        const value = (event.currentTarget as HTMLSelectElement).value
        if (value !== 'auto' && value !== 'send' && value !== 'newline') return
        enterMode = value
        writeEnterMode(value)
    }
</script>

<div data-part="chat-composer">
    <ExtrasStrip files={shownDraft.fileInput} currentCharacter={character} {stickersOpen} showSuggestions={DBState.db.useAutoSuggestions} translatePreview={shownDraft.messageInputTranslate} onremove={(index) => surface.writeDraft((record) => { record.fileInput.splice(index, 1) })} onselect={selectSticker}>
        <Suggestion messageInput={(message) => surface.writeDraft((record) => { record.messageInput = (
            (DBState.db.subModel === 'textgen_webui' || DBState.db.subModel === 'mancer' || DBState.db.subModel.startsWith('local_')) && DBState.db.autoSuggestClean
                ? message.replace(/ +\(.+?\) *$| - [^"'*]*?$/, '') : message
        ) })} send={() => sendMain(source, false)} />
    </ExtrasStrip>
    {#if DBState.db.useAutoTranslateInput && DBState.db.translator}
        <textarea bind:this={translateInput} data-part="chat-composer-translate" data-kind="field" aria-label={language.enterMessageForTranslateToEnglish} placeholder={language.enterMessageForTranslateToEnglish} value={shownDraft.messageInputTranslate} readonly={isComposerLocked()} oninput={(event) => { surface.writeDraft((record) => { record.messageInputTranslate = event.currentTarget.value }); const key = surface.resolveDraftKeyForWrite(); if (key) void updateInputTransateMessage(key, true) }} onkeydown={keydown} oncompositionstart={() => enter.compositionStart()} oncompositionend={() => enter.compositionEnd()}></textarea>
    {/if}
    <div data-part="chat-composer-row">
        <button data-part="chat-composer-plus" data-kind="icon-button" aria-label={language.chatShellMoreActions} onclick={(event) => onplus(event.currentTarget)}>+</button>
        <button data-part="chat-composer-persona" data-kind="chip" aria-label={language.chatShellChoosePersona} onclick={(event) => onpersona(event.currentTarget)}>{language.asPersona(personaName)}</button>
        <textarea bind:this={input} data-part="chat-composer-input" data-kind="field" aria-label={language.chatShellMessage} placeholder={language.chatShellMessage} value={shownDraft.messageInput} readonly={isComposerLocked()} oninput={(event) => { surface.writeDraft((record) => { record.messageInput = event.currentTarget.value }); const key = surface.resolveDraftKeyForWrite(); if (key) void updateInputTransateMessage(key, false) }} onpaste={paste} onkeydown={keydown} oncompositionstart={() => enter.compositionStart()} oncompositionend={() => enter.compositionEnd()} oncontextmenu={openPopup}></textarea>
        {#if $doingChat || isComposerBusy()}
            <button data-part="chat-composer-stop" data-kind="icon-button" aria-label={language.chatShellStop} onclick={abortChat}><span data-part="chat-composer-progress" data-stage={$chatProcessStage}></span>■</button>
        {:else}
            <button data-part="chat-send" data-kind="icon-button" aria-label={language.chatShellSend} onclick={() => void sendMain(source, false)}>➤</button>
        {/if}
    </div>
    <div data-part="chat-composer-tools">
        <button onclick={() => void postFile()}>{language.postFile}</button>
        {#if DBState.db.useChatSticker}<button onclick={() => stickersOpen = !stickersOpen}>{language.chatShellStickers}</button>{/if}
        <label>{language.enterKey}<select value={enterMode} onchange={setMode}><option value="auto">{language.chatShellEnterAutomatic}</option><option value="send">{language.chatShellEnterSend}</option><option value="newline">{language.chatShellEnterNewline}</option></select></label>
    </div>
</div>

<style>
    [data-part="chat-composer"] { flex: none; padding: var(--space-3) var(--space-7) max(var(--space-7), env(safe-area-inset-bottom)); background: var(--nexus-canvas); color: var(--nexus-text); border-top: 1px solid var(--nexus-edge); }
    [data-part="chat-composer-row"] { display: flex; align-items: end; gap: var(--space-3); }
    [data-part="chat-composer-row"] > button { min-width: var(--size-touch); min-height: var(--size-touch); color: inherit; }
    [data-part="chat-composer-input"], [data-part="chat-composer-translate"] { min-width: 0; min-height: var(--size-touch); max-height: calc(5 * var(--leading-field-22) + 2 * var(--composer-field-padding-y)); resize: none; overflow-y: auto; padding: var(--composer-field-padding-y) var(--composer-field-padding-x); line-height: var(--leading-field-22); background: var(--nexus-surface-raised); color: var(--nexus-text); border: 1px solid var(--nexus-edge); border-radius: var(--radius-field); }
    [data-part="chat-composer-input"] { flex: 1; }
    [data-part="chat-composer-translate"] { display: block; width: 100%; margin-bottom: var(--space-3); }
    [data-part="chat-composer-tools"] { display: flex; justify-content: space-between; font-size: var(--font-size-xs); }
    [data-part="chat-composer-tools"] button, [data-part="chat-composer-tools"] select { min-height: var(--size-14); color: inherit; }
    [data-part="chat-composer-progress"] { display: inline-block; width: var(--size-7); height: var(--size-7); border: var(--stroke-bold) solid currentColor; border-radius: var(--radius-circle); }
    @media (prefers-reduced-motion: no-preference) { [data-part="chat-composer-progress"] { animation: progress var(--dur-spin) var(--ease-linear) infinite; } }
    :global(html.rm) [data-part="chat-composer-progress"], :global(html[data-low-power]) [data-part="chat-composer-progress"], :global(html.nexus-low-power) [data-part="chat-composer-progress"] { animation: none; }
    @keyframes progress { to { transform: rotate(var(--angle-turn)); } }
</style>
