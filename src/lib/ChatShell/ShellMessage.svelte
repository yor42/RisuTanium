<script lang="ts">
    import type { Message, StreamingDisplayOptimizationMode } from '../../ts/storage/database.svelte'
    import { getCurrentCharacter } from '../../ts/storage/database.svelte'
    import { ParseMarkdown, type CbsConditions, type simpleCharacterArgument } from '../../ts/parser/parser.svelte'
    import type { TreeView } from '../../ts/process/chatTreeView'
    import type { MessageIdentity } from '../../ts/draftContents'
    import { draftIdentityKey } from '../../ts/draftContents'
    import { chatWindowKey } from '../../ts/chatWindowPolicy'
    import { DBState, selIdState, HideIconStore } from '../../ts/stores.svelte'
    import { aiLawApplies, changeChatTo, foldChatToMessage } from '../../ts/globalApi.svelte'
    import { createMessageEditorController } from '../../ts/process/messageEditorController.svelte'
    import { handleButtonTriggerWithin, handleFormTriggerWithin, playMessageTTS } from '../../ts/process/messageActions.svelte'
    import { hasModuleStubs } from '../../ts/process/moduleRefList'
    import { ensureCurrentModulesOrAlert } from '../../ts/process/moduleEnsure'
    import { getLLMCache } from '../../ts/translator/translator'
    import { isTTSVoiceMode } from '../../ts/process/ttsModes'
    import { alertError, alertRequestData } from '../../ts/alert'
    import { risuChatParser } from '../../ts/process/scripts'
    import { buildDisplayParseOptions } from '../../ts/process/displayParseOptions'
    import { recordCaughtError } from '../../ts/caughtErrors'
    import ChatBody from '../ChatScreens/ChatBody.svelte'
    import PartialEditController from '../ChatScreens/PartialEditController.svelte'
    import StreamingView from './StreamingView.svelte'
    import MessageEditor from './MessageEditor.svelte'
    import TranslationEditor from './TranslationEditor.svelte'
    import { chatSurface, isChatSurfaceInstalled } from '../ChatScreens/chatSurface.svelte'
    import { language } from '../../lang'
    import { getCharImage } from '../../ts/characters'
    import { getModelInfo } from '../../ts/model/modellist'
    import { onDestroy, onMount, untrack } from 'svelte'

    interface Props {
        idx: number
        message: Message
        chatId?: string
        name: string
        img?: string | Promise<string>
        character?: simpleCharacterArgument | string | null
        totalLength?: number
        firstMessage?: boolean
        isLastMemory?: boolean
        largePortrait?: boolean
        rerollIcon?: 'dynamic'
        messageGenerationInfo?: Message['generationInfo']
        role?: Message['role']
        isComment?: boolean
        disabled?: boolean | 'allBefore'
        expectedId?: string
        surface?: boolean
        streamingOptimizationMode?: StreamingDisplayOptimizationMode
        rawStreamingText?: string
        isOptimizedStreamingMessage?: boolean
        interrupted?: boolean
        deferAutoTranslate?: boolean
        streaming?: boolean
        run?: 'first' | 'middle' | 'last' | 'single'
        guiRevision?: number
        onReroll?: () => void
        unReroll?: () => void
        onStep?: (index: number, expectedId: string | undefined, direction: 'back' | 'forward') => void
        onBranch?: (index: number, expectedId: string | undefined) => void
        getTreeView?: () => TreeView | null
        getBusy?: () => boolean
    }
    let { idx, message, chatId, name, img = '', character = null, firstMessage = false,
        isLastMemory = false, messageGenerationInfo, interrupted = message.interrupted === true,
        deferAutoTranslate = false, streaming = false, run = 'single', disabled = false, guiRevision = 0 }: Props = $props()
    let translated = $state(false)
    let translating = $state(false)
    let retranslate = $state(false)
    let bodyRoot = $state<HTMLElement | null>(null)
    let avatar = $state<string | null>(null)
    let iconMounted = $state(false)
    let bodyRevision = $state(0)
    let msgDisplay = $state(message.data)
    let renderFailed = $state(false)
    let destroyed = false
    onMount(() => { queueMicrotask(() => { if (!destroyed) iconMounted = true }) })
    onDestroy(() => { destroyed = true; editor.dispose() })
    $effect(() => {
        let live = true
        avatar = null
        if (iconMounted) Promise.resolve(img).then((source) => getCharImage(source, 'plain'))
            .then((value) => { if (live && typeof value === 'string') avatar = value })
            .catch(() => { if (live) avatar = null })
        return () => { live = false }
    })
    const surfaceEpoch = isChatSurfaceInstalled() ? untrack(() => chatSurface.rebuildEpoch) : null
    let labelId = $derived(`shell-message-name-${idx}-${chatId ?? 'first'}`)
    let modelShortName = $derived.by(() => {
        const model = (messageGenerationInfo ?? message.generationInfo)?.model
        if (!model) return ''
        const shortName = getModelInfo(model).shortName
        return shortName.charAt(0).toUpperCase() + shortName.slice(1)
    })
    let owner = $derived(DBState.db.characters?.[selIdState.selId])
    let chat = $derived(owner?.chats?.[owner.chatPage])
    let isBookmarked = $derived(Boolean(chatId && chat?.bookmarks?.includes(chatId)))
    let canSpeak = $derived(idx > -1 && owner?.type !== 'group' && isTTSVoiceMode(owner?.ttsMode))
    $effect.pre(() => {
        if (surfaceEpoch !== null && chatSurface.hidden) return
        if (streaming) return
        void guiRevision
        try {
            msgDisplay = risuChatParser(message.data, buildDisplayParseOptions({
                chara: name, chatID: idx, firstmsg: firstMessage, chatRole: chat?.message?.[idx]?.role ?? null,
            }))
            renderFailed = false
        } catch (error) {
            recordCaughtError('chat.parse', error)
            msgDisplay = message.data
            renderFailed = true
        }
    })
    function currentMessageIdentity(): MessageIdentity {
        return { kind: 'msg', chatKey: chatWindowKey(owner?.chaId, chat), chatId: chat?.message?.[idx]?.chatId, index: idx }
    }
    function translationOpenToken() {
        const row = chat?.message?.[idx]
        return { identity: draftIdentityKey(currentMessageIdentity()), row, data: row?.data, closeEpoch: chatSurface.closeEpoch }
    }
    function translationOpenCurrent(token: ReturnType<typeof translationOpenToken>): boolean {
        return !destroyed && token.closeEpoch === chatSurface.closeEpoch
            && token.identity === draftIdentityKey(currentMessageIdentity())
            && token.row === chat?.message?.[idx] && token.data === token.row?.data
    }
    function cbsConditions(): CbsConditions {
        return { firstmsg: firstMessage, chatRole: chat?.message?.[idx]?.role ?? null }
    }
    async function getTranslationCacheKey(): Promise<string | null> {
        if (DBState.db.translateBeforeHTMLFormatting) return msgDisplay
        if (hasModuleStubs() && !(await ensureCurrentModulesOrAlert())) return null
        return ParseMarkdown(msgDisplay, character, DBState.db.legacyTranslation ? 'notrim' : 'pretranslate', idx, cbsConditions())
    }
    const editor = createMessageEditorController({
        getMessage: () => message.data,
        setMessage: (value) => { message.data = value },
        getIdx: () => idx,
        currentMessageIdentity,
        getTranslationCacheKey,
        translationOpenToken,
        translationOpenCurrent,
        isDestroyed: () => destroyed,
        onTranslationCacheWritten: () => { bodyRevision += 1 },
    })
    async function getTranslationPartialEditContext(): Promise<{ key: string; data: string } | null | 'unavailable'> {
        if (!translated || DBState.db.translatorType !== 'llm') return null
        const token = translationOpenToken()
        const key = await getTranslationCacheKey()
        if (key === null || !translationOpenCurrent(token)) return 'unavailable'
        const data = await getLLMCache(key)
        if (!translationOpenCurrent(token)) return 'unavailable'
        return data === null ? null : { key, data }
    }
    async function handlePartialEditSave(event: CustomEvent<{ newData: string; target: 'original' | 'translation'; translationKey?: string }>) {
        if (idx < 0) return
        if (event.detail.target === 'translation') {
            if (event.detail.translationKey) await editor.updateTranslationCache(event.detail.translationKey, event.detail.newData).catch(alertError)
            return
        }
        const row = chat?.message?.[idx]
        if (!row || row.chatId !== chatId) return
        row.data = event.detail.newData
        delete row.interrupted
        message.data = event.detail.newData
        bodyRevision += 1
    }
</script>

<article class="risu-chat" class:user={message.role === 'user'} data-part="chat-message" data-role={message.role} data-run={firstMessage ? 'single' : run} data-meta="shown" data-streaming={streaming ? '' : undefined} data-hidden={disabled ? '' : undefined} data-bookmarked={isBookmarked ? '' : undefined} data-chat-index={idx} data-chat-id={chatId ?? ''} aria-labelledby={labelId} onclickcapture={(event) => handleButtonTriggerWithin(event, () => idx)} onsubmitcapture={(event) => handleFormTriggerWithin(event, () => idx)}>
    {#if disabled === true}<div data-part="chat-message-divider" data-kind="disabled"></div>{/if}
    <div data-part="chat-message-name-row">
        <div data-part="chat-message-meta">
            {#if !$HideIconStore && iconMounted}
                {#if avatar}<img data-part="chat-message-avatar" src={avatar} alt="" onerror={() => { avatar = null }} />
                {:else}<span data-part="chat-message-avatar" aria-hidden="true">{name.slice(0, 1)}</span>{/if}
            {/if}
            <span data-part="chat-message-name" id={labelId}>{name}</span>
            {#if isBookmarked}<span data-part="chat-message-badges" aria-label={language.bookmark}>★</span>{/if}
        </div>
    </div>
    {#if (messageGenerationInfo ?? message.generationInfo) && (DBState.db.requestInfoInsideChat || aiLawApplies())}
        <button type="button" data-part="chat-message-generation-info" onclick={() => alertRequestData({ genInfo: chat?.message?.[idx]?.generationInfo ?? messageGenerationInfo ?? message.generationInfo, idx })}>{modelShortName}</button>
    {/if}
    {#if DBState.db.translator !== '' && !streaming && idx >= 0}
        <button type="button" data-part="chat-message-translate" aria-pressed={translated} aria-busy={translating} disabled={editor.translationViewControlsDisabled} onclick={() => { translated = !translated }}>{language.translate}</button>
        {#if DBState.db.translatorType === 'llm' && translated}
            <button type="button" data-part="chat-message-retranslate" disabled={editor.translationViewControlsDisabled} onclick={() => { retranslate = true }}>{language.retranslate}</button>
            <button type="button" data-part="chat-message-translation-edit" disabled={editor.translationEditControlDisabled} onclick={() => { if (editor.editTranslationMode) editor.saveTranslationEdit().catch(alertError); else editor.loadTranslationForEdit().catch(alertError) }}>{editor.editTranslationMode ? language.editTranslationSave : language.editTranslation}</button>
        {/if}
    {/if}
    {#if idx >= 0 && !streaming}<button type="button" data-part="chat-message-edit" disabled={editor.originalEditControlDisabled} onclick={editor.toggleOriginalEdit}>{language.edit}</button>{/if}
    {#if canSpeak && !streaming}<button type="button" data-part="chat-message-tts" onclick={() => playMessageTTS(translated, bodyRoot, msgDisplay, getCurrentCharacter())}>TTS</button>{/if}
    <MessageEditor {editor} />
    <TranslationEditor {editor} />
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div data-part="chat-message-body" class="prose" bind:this={bodyRoot} onclick={() => { if (DBState.db.clickToEdit && idx >= 0 && !streaming) editor.startOriginalEdit() }}>
        {#if editor.editMode || editor.editTranslationMode}
        {:else if message.isComment}
            {#if msgDisplay.startsWith('{{specialcomment') && msgDisplay.split('::')[1] === 'branchedfrom'}
                <button type="button" data-part="chat-message-branch-origin" onclick={() => { const parts = msgDisplay.split('::'); changeChatTo(parts[2] ?? ''); foldChatToMessage(parts[4]) }}>{language.branchedText.replace('{}', msgDisplay.split('::')[3] ?? '')}</button>
            {:else}
                {msgDisplay}
            {/if}
        {:else if firstMessage && (message.data === '' || message.data === '{{blank}}' || message.data === '{{none}}')}
            {language.noMessage}
        {:else if streaming}
            <StreamingView text={message.data} {modelShortName} {character} />
        {:else}
            <ChatBody {character} {firstMessage} {idx} {msgDisplay} {name} role={message.role}
                {bodyRoot} {modelShortName} renderRevision={guiRevision + bodyRevision} {deferAutoTranslate}
                {surfaceEpoch} bind:translated bind:translating bind:retranslate />
        {/if}
    </div>
    {#if idx >= 0 && !streaming && !editor.editMode && !editor.editTranslationMode && (DBState.db.enableBlockPartialEdit || DBState.db.enableDragPartialEdit)}
        <PartialEditController messageData={message.data} chatIndex={idx} {bodyRoot} blockEditEnabled={DBState.db.enableBlockPartialEdit} dragEditEnabled={DBState.db.enableDragPartialEdit} translatedView={translated} getTranslationEditContext={getTranslationPartialEditContext} on:save={handlePartialEditSave} />
    {/if}
    {#if renderFailed}<div data-part="chat-message-render-failed" role="note">{language.messageRenderFailed}</div>{/if}
    {#if interrupted && !streaming}<div data-part="chat-message-interrupted" role="note">{language.messageInterrupted}</div>{/if}
    {#if message.time}<time data-part="chat-message-timestamp" datetime={new Date(message.time).toISOString()}>{new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', month: '2-digit', day: '2-digit', hour12: false }).format(message.time)}</time>{/if}
    {#if isLastMemory}<div data-part="chat-message-memory-limit" style:border-top-width={`${DBState.db.memoryLimitThickness}px`}></div>{/if}
    {#if disabled}<div data-part="chat-message-divider" data-kind={disabled === 'allBefore' ? 'all-before' : 'disabled'}></div>{/if}
</article>

<style>
    [data-part="chat-message"] { width: 100%; padding: var(--space-8) var(--space-12); color: var(--nexus-text); }
    [data-part="chat-message-name-row"] { min-height: var(--message-name-row-height); }
    [data-part="chat-message-meta"] { display: flex; align-items: center; gap: var(--message-meta-gap); color: var(--nexus-text-secondary); }
    [data-part="chat-message-avatar"] { display: inline-flex; align-items: center; justify-content: center; width: var(--size-avatar-sm); height: var(--size-avatar-sm); border-radius: var(--radius-circle); background: var(--nexus-surface-raised); }
    [data-part="chat-message-body"] { max-width: var(--thread-max-width); width: 100%; overflow-wrap: anywhere; }
    [data-part="chat-message"].user { border-left: var(--stroke-bold) solid var(--nexus-surface-raised); }
    [data-part="chat-message-interrupted"] { color: var(--nexus-text-secondary); font-style: italic; font-size: var(--font-size-xs); }
    [data-part="chat-message-render-failed"] { color: var(--nexus-text-secondary); font-style: italic; font-size: var(--font-size-xs); }
    [data-part="chat-message-divider"] { border-top: var(--stroke-bold) dashed var(--color-warning); }
    [data-part="chat-message-divider"][data-kind="disabled"] { border-top-color: var(--color-accent); }
    [data-part="chat-message-memory-limit"] { border-top-style: solid; border-top-color: var(--color-accent); }
    button { color: var(--nexus-text-secondary); }
</style>
