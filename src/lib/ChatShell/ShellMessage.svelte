<script lang="ts">
    import type { Message, StreamingDisplayOptimizationMode } from '../../ts/storage/database.svelte'
    import { getCurrentCharacter } from '../../ts/storage/database.svelte'
    import { ParseMarkdown, type CbsConditions, type simpleCharacterArgument } from '../../ts/parser/parser.svelte'
    import type { TreeView } from '../../ts/process/chatTreeView'
    import type { MessageIdentity } from '../../ts/draftContents'
    import { draftIdentityKey } from '../../ts/draftContents'
    import { chatWindowKey } from '../../ts/chatWindowPolicy'
    import { DBState, selIdState, HideIconStore } from '../../ts/stores.svelte'
    import { ColorSchemeTypeStore } from '../../ts/gui/colorscheme'
    import { aiLawApplies, changeChatTo, foldChatToMessage } from '../../ts/globalApi.svelte'
    import { createMessageEditorController } from '../../ts/process/messageEditorController.svelte'
    import { handleButtonTriggerWithin, handleFormTriggerWithin, playMessageTTS, requestRemove, deleteNow, type DeleteMode, copyMessageText, copyMessageAsCard, branchMessage, toggleMessageDisabled, toggleBookmark } from '../../ts/process/messageActions.svelte'
    import { stopTTS } from '../../ts/process/tts'
    import { stepSibling } from '../../ts/process/composerActions.svelte'
import { originOf, isWriting } from '../../ts/process/chatOrigin'
import { requestStopDelete, isStopDeletePending } from '../../ts/chatShell/stopDelete.svelte'
    import { createSwipeGesture, createWheelSteps, type SwipeResult } from '../../ts/chatShell/swipeGesture'
    import { classifyEdge } from '../../ts/chatShell/edgeZones'
    import { tickHaptic, readHaptics } from '../../ts/chatShell/haptics'
    import { createMessageKeys } from '../../ts/chatShell/messageKeys'
    import { ACTION_IDS, type ActionId } from '../../ts/chatShell/actionSlots'
    import { backCloseHandler, registerBackHandler } from '../../ts/backHandlers'
    import { gestureInsetLeft } from '../../ts/android/hostBridge'
    import { hasModuleStubs } from '../../ts/process/moduleRefList'
    import { ensureCurrentModulesOrAlert } from '../../ts/process/moduleEnsure'
    import { getLLMCache } from '../../ts/translator/translator'
    import { isTTSVoiceMode } from '../../ts/process/ttsModes'
    import { alertConfirm, alertError, alertNormal, alertRequestData } from '../../ts/alert'
    import { risuChatParser } from '../../ts/process/scripts'
    import { buildDisplayParseOptions } from '../../ts/process/displayParseOptions'
    import { recordCaughtError } from '../../ts/caughtErrors'
    import ChatBody from '../ChatScreens/ChatBody.svelte'
    import PartialEditController from '../ChatScreens/PartialEditController.svelte'
    import StreamingView from './StreamingView.svelte'
    import MessageEditor from './MessageEditor.svelte'
    import TranslationEditor from './TranslationEditor.svelte'
    import MessageMeta from './MessageMeta.svelte'
    import ActionSheet from './ActionSheet.svelte'
    import CustomizeButtonsSheet from './CustomizeButtonsSheet.svelte'
    import AlternativesRow from './AlternativesRow.svelte'
    import { chatSurface, isChatSurfaceInstalled } from '../ChatScreens/chatSurface.svelte'
    import { language } from '../../lang'
    import { getCharImage } from '../../ts/characters'
    import { getModelInfo } from '../../ts/model/modellist'
    import { onDestroy, onMount, untrack } from 'svelte'
    type SheetAction = ActionId | 'copyCard' | 'retranslate' | 'editTranslation' | 'partialEdit' | 'hideAbove'

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
    let { idx, message, chatId, name, img = '', character = null, firstMessage = false, expectedId, onBranch, getTreeView, getBusy,
        isLastMemory = false, messageGenerationInfo, interrupted = message.interrupted === true,
        deferAutoTranslate = false, streaming = false, run = 'single', disabled = false, guiRevision = 0 }: Props = $props()
    let translated = $state(false)
    let translating = $state(false)
    let retranslate = $state(false)
    let bodyRoot = $state<HTMLElement | null>(null)
    let avatar = $state<string | null>(null)
    let iconMounted = $state(false)
    let bodyRevision = $state(0)
    let msgDisplay = $state(untrack(() => message.data))
    let renderFailed = $state(false)
    let actionOpen = $state(false)
    let customizeOpen = $state(false)
    let actionOpener = $state<HTMLElement | null>(null)
    let anchor = $state<{ x: number; y: number }>()
    let meta: ReturnType<typeof MessageMeta> | undefined
    let alternatives = $state<ReturnType<typeof AlternativesRow>>()
    let speaking = $state(false)
    let swipe = $state<ReturnType<typeof createSwipeGesture> | null>(null)
    let wheel = createWheelSteps(0, 1)
    let pointerType = ''
    let pointerStart = { x: 0, y: 0 }
    let longPressTimer: ReturnType<typeof setTimeout> | undefined
    let longPressRing = $state(false)
    let swipeProgress = $state(0)
    let dragX = $state(0)
    let armed = $state(false)
    const keys = createMessageKeys()
    let destroyed = false
    onMount(() => { queueMicrotask(() => { if (!destroyed) iconMounted = true }) })
    onDestroy(() => { destroyed = true; clearTimeout(longPressTimer); unregisterEditorBack(); editor.dispose() })
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
    let rowOrigin = $derived(owner?.chaId && chat?.id ? originOf(owner, chat) : null)
    let stopDeletePending = $derived(isStopDeletePending(rowOrigin))
    let isBookmarked = $derived(Boolean(chatId && chat?.bookmarks?.includes(chatId)))
    let canSpeak = $derived(idx > -1 && owner?.type !== 'group' && isTTSVoiceMode(owner?.ttsMode))
    let position = $derived(getTreeView?.()?.at(idx) ?? { index: 1, count: 1 })
    let newestCharacter = $derived(message.role === 'char' && idx >= 0 && idx === (chat?.message?.length ?? 0) - 1)
    let actions = $derived(ACTION_IDS.filter((id) => id !== 'deleteAfter').filter((id) => idx >= 0 || id === 'copy' || id === 'selectText' || id === 'stepPrev' || id === 'stepNext' || id === 'customizeButtons').filter((id) => id !== 'readAloud' || canSpeak).filter((id) => id !== 'translate' || DBState.db.translator !== '').filter((id) => id !== 'newReply' || newestCharacter).filter((id) => !['stepPrev', 'stepNext'].includes(id) || newestCharacter || firstMessage).filter((id) => id !== 'branch' || onBranch !== undefined))
    let sheetActions = $derived<SheetAction[]>([...actions, 'copyCard', ...(idx >= 0 ? ['hideAbove', 'deleteAfter'] as SheetAction[] : []), ...(idx >= 0 && !streaming && DBState.db.translatorType === 'llm' ? ['retranslate', 'editTranslation'] as SheetAction[] : []), ...(idx >= 0 && !streaming && (DBState.db.enableBlockPartialEdit || DBState.db.enableDragPartialEdit) ? ['partialEdit'] as SheetAction[] : [])])
    let unavailable = $derived(ACTION_IDS.filter((id) => streaming && ['edit', 'translate', 'readAloud', 'branch', 'newReply'].includes(id) || stopDeletePending && (id === 'delete' || id === 'deleteAfter') || getBusy?.() === true && ['stepPrev', 'stepNext', 'newReply'].includes(id)))
    $effect(() => { wheel = createWheelSteps(position.index - 1, position.count) })
    const source = { closeMenu: () => {} }
    function liveIndex(): number { return chatId ? (chat?.message.findIndex((item) => item.chatId === chatId) ?? idx) : idx }
    function openActions(opener: HTMLElement, point?: { x: number; y: number }): void { actionOpener = opener; anchor = point; actionOpen = true }
    // A generating reply, or a range that reaches the running send, is stopped first and removed once the send has settled.
    async function removeMessage(mode: DeleteMode): Promise<void> {
        if (!owner || !chat || idx < 0) return
        const target = chat.message[liveIndex()]
        if (!target) return
        const origin = originOf(owner, chat)
        if (origin && isStopDeletePending(origin)) return
        const after = mode === 'from' ? chat.message.length - chat.message.indexOf(target) - 1 : 0
        if (streaming || mode === 'from' && origin !== null && isWriting(origin)) {
            if (!await alertConfirm(language.chatShellStopDeleteConfirm(after))) return
            if (!requestStopDelete(owner, chat, target, mode) && !isStopDeletePending()) alertNormal(language.chatShellStopDeleteChanged)
        } else if (mode === 'from') {
            if (!await alertConfirm(language.chatShellDeleteFromHereConfirm(after))) return
            deleteNow(owner, chat, target, 'from')
        } else await requestRemove(owner, chat, target)
    }
    async function act(id: SheetAction): Promise<void> {
        if ((unavailable as readonly SheetAction[]).includes(id)) return
        switch (id) {
            case 'copy': {
                const selection = window.getSelection()
                const selected = selection && bodyRoot?.contains(selection.anchorNode) && bodyRoot?.contains(selection.focusNode) ? selection.toString() : ''
                copyMessageText(selected || (streaming ? message.data : msgDisplay), () => {})
                break
            }
            case 'copyCard': copyMessageAsCard({ owner: message, captureText: () => streaming ? message.data : msgDisplay, report: () => {}, role: () => message.role, name: () => name, messageGenerationInfo: () => message.generationInfo ?? null, idx: liveIndex, getCbsCondition: cbsConditions }); break
            case 'selectText': bodyRoot?.focus(); break
            case 'edit': editor.toggleOriginalEdit(); break
            case 'translate': translated = !translated; break
            case 'retranslate': retranslate = true; translated = true; break
            case 'editTranslation': await editor.loadTranslationForEdit(); break
            case 'partialEdit': bodyRoot?.focus(); break
            case 'readAloud':
                speaking = true
                try { await playMessageTTS(translated, bodyRoot, msgDisplay, getCurrentCharacter()) }
                finally { speaking = false }
                break
            case 'branch': await branchMessage(liveIndex, chatId, onBranch); break
            case 'bookmark': await toggleBookmark(liveIndex(), name); break
            case 'hideAI': await toggleMessageDisabled(liveIndex, 'one'); break
            case 'hideAbove': await toggleMessageDisabled(liveIndex, 'above'); break
            case 'delete': await removeMessage('one'); break
            case 'deleteAfter': await removeMessage('from'); break
            case 'stepPrev': await stepSibling(source, liveIndex(), chatId, 'back', { generate: false }); alternatives?.markPageChange(); break
            case 'stepNext': await stepSibling(source, liveIndex(), chatId, 'forward', { generate: false }); alternatives?.markPageChange(); break
            case 'newReply': alternatives?.requestNewReply(); break
            case 'customizeButtons': customizeOpen = true; break
        }
    }
    const unregisterEditorBack = registerBackHandler(backCloseHandler({
        isOpen: () => editor.editMode || editor.editTranslationMode,
        snapshot: () => `${editor.editMode}:${editor.editTranslationMode}:${editor.discardConfirmOpen}`,
        close: () => { if (editor.editTranslationMode) editor.closeTranslationKeep(); else void editor.requestDiscardOriginalEdit() },
    }))
    const HOST_INSET_PROBE_PX = 64
    function readHostInset(xPx: number): number {
        if (xPx > HOST_INSET_PROBE_PX) return 0
        try {
            const value: unknown = gestureInsetLeft()
            return typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, 0), HOST_INSET_PROBE_PX) : 0
        } catch { return 0 }
    }
    function sample(event: PointerEvent) { return { x: event.clientX, y: event.clientY, time: event.timeStamp } }
    function onPointerDown(event: PointerEvent): void {
        if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return
        if ((event.target as HTMLElement).closest('button, a, input, textarea, [contenteditable]')) return
        pointerType = event.pointerType
        pointerStart = { x: event.clientX, y: event.clientY }
        const horizontalChild = (event.target as HTMLElement).closest('[data-part="chat-message-body"]')?.querySelector<HTMLElement>('*')
        const edge = classifyEdge({ xPx: event.clientX, viewportWidthPx: window.innerWidth, dpPerPx: 1, hostInsetDp: readHostInset(event.clientX), rtl: document.dir === 'rtl' }) === 'edge'
        swipe = createSwipeGesture({ widthPx: bodyRoot?.clientWidth ?? 320, dpPerPx: 1, index: position.index - 1, count: position.count, edge: edge || !!horizontalChild && horizontalChild.scrollWidth > horizontalChild.clientWidth, streaming, firstMessage, enabled: DBState.db.swipe, pointerType: event.pointerType })
        swipe.down(sample(event))
        clearTimeout(longPressTimer)
        const opener = event.currentTarget as HTMLElement
        longPressTimer = setTimeout(() => { if (swipe) { swipe.cancel(); longPressRing = false; openActions(opener, pointerStart) } }, 500)
        setTimeout(() => { if (longPressTimer) longPressRing = true }, 200)
    }
    function onPointerMove(event: PointerEvent): void {
        if (!swipe) return
        if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 10) { clearTimeout(longPressTimer); longPressTimer = undefined; longPressRing = false }
        const result = swipe.move(sample(event))
        swipeProgress = result.progress
        armed = result.event === 'arm' || armed && result.progress >= 1
        if (result.locked) {
            const delta = event.clientX - pointerStart.x
            const width = bodyRoot?.clientWidth ?? 320
            const easy = width * 0.4
            dragX = Math.sign(delta) * (Math.min(Math.abs(delta), easy) + Math.max(0, Math.abs(delta) - easy) * 0.35)
        }
        if (result.event === 'arm') tickHaptic('arm', pointerType, readHaptics())
    }
    function finishSwipe(result: SwipeResult): void {
        clearTimeout(longPressTimer); longPressTimer = undefined; longPressRing = false; swipe = null; swipeProgress = 0; dragX = 0; armed = false
        if (result.event === 'stepPrev' || result.event === 'stepNext') { tickHaptic('commit', pointerType, readHaptics()); void act(result.event === 'stepPrev' ? 'stepPrev' : 'stepNext') }
        if (result.event === 'generate') alternatives?.requestNewReply()
    }
    function onWheel(event: WheelEvent): void {
        const result = wheel({ dx: event.deltaX, dy: event.deltaY, time: event.timeStamp, shiftKey: event.shiftKey })
        if (result === 'stepPrev' || result === 'stepNext') { event.preventDefault(); void act(result === 'stepPrev' ? 'stepPrev' : 'stepNext') }
    }
    function onMessageKey(event: KeyboardEvent): void {
        if (event.target !== event.currentTarget && !(event.ctrlKey && event.altKey && event.key.toLowerCase() === 'r')) return
        const action = keys.handle(event, { focus: 'message', index: position.index - 1, count: position.count, newestCharacter, firstMessage, now: performance.now() })
        if (action === 'openActions') { event.preventDefault(); openActions(event.currentTarget as HTMLElement) }
        else if (ACTION_IDS.some((id) => id === action)) { event.preventDefault(); void act(action as ActionId) }
    }
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

<!-- The article keeps the transcript semantics and is the focus target of roving message focus (tabindex -1), so its key and context-menu events and the captured clicks and submits of rich message content must reach it; the swipe gesture listens on the body. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<article class="risu-chat" class:user={message.role === 'user'} data-part="chat-message" data-role={message.role} data-run={firstMessage ? 'single' : run} data-meta="shown" data-streaming={streaming ? '' : undefined} data-hidden={disabled ? '' : undefined} data-bookmarked={isBookmarked ? '' : undefined} data-chat-index={idx} data-chat-id={chatId ?? ''} aria-labelledby={labelId} tabindex="-1" onclickcapture={(event) => handleButtonTriggerWithin(event, liveIndex)} onsubmitcapture={(event) => handleFormTriggerWithin(event, liveIndex)} onkeydown={onMessageKey} oncontextmenu={(event) => { if (!window.getSelection()?.toString() || event.shiftKey) { event.preventDefault(); openActions(event.currentTarget, { x: event.clientX, y: event.clientY }) } }}>
    {#if disabled === true}<div data-part="chat-message-divider" data-kind="disabled"></div>{/if}
    <div data-part="chat-message-name-row">
        <div data-part="chat-message-meta">
            {#if !$HideIconStore && iconMounted}
                {#if avatar}<img data-part="chat-message-avatar" data-round={DBState.db.roundIcons ? '' : undefined} src={avatar} alt="" onerror={() => { avatar = null }} />
                {:else}<span data-part="chat-message-avatar" data-round={DBState.db.roundIcons ? '' : undefined} aria-hidden="true">{name.slice(0, 1)}</span>{/if}
            {/if}
            <span data-part="chat-message-name" id={labelId}>{name}</span>
            {#if isBookmarked}<span data-part="chat-message-badges" aria-label={language.bookmark}>★</span>{/if}
            <MessageMeta bind:this={meta} {name} time={message.time} model={modelShortName} available={actions} disabled={unavailable} onaction={(id) => { void act(id) }} onmore={openActions} />
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
    {#if speaking}<button type="button" data-part="chat-message-stop-tts" onclick={() => { stopTTS(); speaking = false }}>{language.ttsStop}</button>{/if}
    <MessageEditor {editor} />
    <TranslationEditor {editor} />
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div data-part="chat-message-body" class="text chat-width chattext prose minw-0" class:prose-invert={$ColorSchemeTypeStore} style:font-size={`${0.875 * ((DBState.db.zoomsize ?? 100) / 100)}rem`} style:line-height={`${(DBState.db.lineHeight ?? 1.25) * ((DBState.db.zoomsize ?? 100) / 100)}rem`} bind:this={bodyRoot} style:transform={`translateX(${dragX}px)`} onpointerdown={onPointerDown} onpointermove={onPointerMove} onpointerup={(event) => { if (swipe) finishSwipe(swipe.up(sample(event))) }} onpointercancel={() => { if (swipe) finishSwipe(swipe.cancel()) }} onwheel={onWheel} onclick={() => { if (DBState.db.clickToEdit && idx >= 0 && !streaming) editor.startOriginalEdit() }}>
        {#if editor.editMode || editor.editTranslationMode}<!-- the editors replace the body while open -->
        {:else if message.isComment}
            {#if msgDisplay.startsWith('{{specialcomment') && msgDisplay.split('::')[1] === 'branchedfrom'}
                <button type="button" data-part="chat-message-branch-origin" onclick={() => { const parts = msgDisplay.split('::'); changeChatTo(parts[2] ?? ''); foldChatToMessage(parts[4]) }}>{language.branchedText.replace('{}', msgDisplay.split('::')[3] ?? '')}</button>
            {:else}
                {msgDisplay}
            {/if}
        {:else if firstMessage && (message.data === '' || message.data === '{{blank}}' || message.data === '{{none}}')}
            {language.noMessage}
        {:else if streaming}
            <StreamingView text={message.data} {modelShortName} {character} parseContext={{ chatID: idx, cbsConditions: cbsConditions(), displayOptions: buildDisplayParseOptions({ chara: name, chatID: idx, firstmsg: firstMessage, chatRole: chat?.message?.[idx]?.role ?? null }) }} />
        {:else}
            <ChatBody {character} {firstMessage} {idx} {msgDisplay} {name} role={message.role}
                {bodyRoot} {modelShortName} renderRevision={guiRevision + bodyRevision} {deferAutoTranslate}
                {surfaceEpoch} bind:translated bind:translating bind:retranslate />
        {/if}
    </div>
    {#if longPressRing}<span data-part="chat-long-press-ring" aria-hidden="true">◌</span>{/if}
    {#if swipeProgress > 0}<span data-part="chat-swipe-arm" role="status" style:opacity={swipeProgress}>{armed ? language.chatShellReleaseNewReply : language.chatShellNoSavedReplies}</span>{/if}
    {#if (newestCharacter || firstMessage) && (position.count > 1 || newestCharacter)}
        <AlternativesRow bind:this={alternatives} {idx} {expectedId} index={position.index} count={position.count} {firstMessage} busy={getBusy?.() ?? false} />
    {/if}
    <ActionSheet open={actionOpen} opener={actionOpener} {anchor} available={sheetActions} disabled={unavailable} generating={streaming} onaction={(id) => { void act(id) }} onclose={() => { actionOpen = false }} />
    <CustomizeButtonsSheet open={customizeOpen} opener={actionOpener} onclose={() => { customizeOpen = false }} onchange={() => meta?.refresh()} />
    {#if idx >= 0 && !streaming && !editor.editMode && !editor.editTranslationMode && (DBState.db.enableBlockPartialEdit || DBState.db.enableDragPartialEdit)}
        <PartialEditController messageData={message.data} chatIndex={idx} {bodyRoot} blockEditEnabled={DBState.db.enableBlockPartialEdit} dragEditEnabled={DBState.db.enableDragPartialEdit} translatedView={translated} getTranslationEditContext={getTranslationPartialEditContext} on:save={handlePartialEditSave} />
    {/if}
    {#if stopDeletePending}<div data-part="chat-message-delete-pending" role="status">{language.chatShellDeletePendingStop}</div>{/if}
    {#if renderFailed}<div data-part="chat-message-render-failed" role="note">{language.messageRenderFailed}</div>{/if}
    {#if interrupted && !streaming}<div data-part="chat-message-interrupted" role="note">{language.messageInterrupted}</div>{/if}
    {#if isLastMemory}<div data-part="chat-message-memory-limit" style:border-top-width={`${DBState.db.memoryLimitThickness}px`}></div>{/if}
    {#if disabled}<div data-part="chat-message-divider" data-kind={disabled === 'allBefore' ? 'all-before' : 'disabled'}></div>{/if}
</article>

<style>
    [data-part="chat-message"] { width: 100%; padding: var(--space-8) var(--space-12); color: var(--nexus-text); }
    [data-part="chat-message-name-row"] { min-height: var(--message-name-row-height); }
    [data-part="chat-message-meta"] { display: flex; align-items: center; gap: var(--message-meta-gap); color: var(--nexus-text-secondary); }
    [data-part="chat-message-avatar"] { display: inline-flex; align-items: center; justify-content: center; width: var(--size-avatar-sm); height: var(--size-avatar-sm); border-radius: var(--radius-circle); background: var(--nexus-surface-raised); }
    [data-part="chat-message-avatar"]:not([data-round]) { border-radius: var(--radius-4); }
    [data-part="chat-message-body"] { max-width: var(--thread-max-width); width: 100%; overflow-wrap: anywhere; }
    [data-part="chat-message"].user { border-left: var(--stroke-bold) solid var(--nexus-surface-raised); }
    [data-part="chat-message-interrupted"] { color: var(--nexus-text-secondary); font-style: italic; font-size: var(--font-size-xs); }
    [data-part="chat-message-delete-pending"] { color: var(--nexus-text-secondary); font-style: italic; font-size: var(--font-size-xs); }
    [data-part="chat-message-render-failed"] { color: var(--nexus-text-secondary); font-style: italic; font-size: var(--font-size-xs); }
    [data-part="chat-message-divider"] { border-top: var(--stroke-bold) dashed var(--color-warning); }
    [data-part="chat-message-divider"][data-kind="disabled"] { border-top-color: var(--color-accent); }
    [data-part="chat-message-memory-limit"] { border-top-style: solid; border-top-color: var(--color-accent); }
    button { color: var(--nexus-text-secondary); }
</style>
