<script lang="ts" module>
    import type { ActionId as ShellActionId } from '../../ts/chatShell/actionSlots'
    export type SheetAction = ShellActionId | 'copyCard' | 'retranslate' | 'editTranslation' | 'partialEdit' | 'hideAbove'
    // What the hosting shell needs to show one row's action sheet outside the transcript; every getter reads the row's live state.
    export interface ActionRequest {
        index: number
        opener: HTMLElement | null
        anchor?: { x: number; y: number }
        available: () => readonly SheetAction[]
        disabled: () => readonly SheetAction[]
        generating: () => boolean
        run: (id: SheetAction) => void
    }
    export interface CustomizeRequest {
        opener: HTMLElement | null
        onchange: () => void
    }
    // A step swaps the shown alternative, which mounts a new row under a new key: the wheel gesture and lock state belong to the list, not to the row that happened to receive the first event.
    const wheelByList = new WeakMap<Element, WheelSteps>()
    // The row that held focus when it stepped hands the focus to its successor at the same position.
    const FOCUS_HANDOVER_MS = 2000
    let focusHandover: { idx: number; until: number } | null = null
    // The successor of a stepped row has no rendered body yet; it keeps the predecessor's height until the body arrives or this many milliseconds pass, so the transcript never collapses under the reader.
    const HEIGHT_FLOOR_MS = 1500
    let heightHandover: { idx: number; chatId: string | undefined; height: number; until: number } | null = null
    // The pending body is empty or one of ChatBody's loading indicators (the parse placeholder with role="status", the translation spinner with its animated element); anything else is the rendered message.
    function bodyRendered(body: HTMLElement): boolean {
        if (body.querySelector('[role="status"], [style*="animation: spin"]') !== null) return false
        return (body.textContent ?? '').trim() !== '' || body.querySelector('*') !== null
    }
</script>

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
    import { stepSibling, regenerateNewest } from '../../ts/process/composerActions.svelte'
    import { originOf, isWriting } from '../../ts/process/chatOrigin'
    import { isActiveStreamReply } from '../../ts/process/activeStreams'
    import { requestStopDelete, isStopDeletePending } from '../../ts/chatShell/stopDelete.svelte'
    import type { CopyOutcome } from '../../ts/chatCopy'
    import { CARD_DEADLINE_MS, CARD_PENDING_MARGIN_MS, type CardReport } from '../../ts/chatCard'
    import { createSwipeGesture, createWheelSteps, ARM_HOLD_MS, RUBBER_BAND_PX, type SwipeResult, type WheelSteps } from '../../ts/chatShell/swipeGesture'
    import { classifyEdge, EDGE_ZONE_DP } from '../../ts/chatShell/edgeZones'
    import { tickHaptic, readHaptics } from '../../ts/chatShell/haptics'
    import { createMessageKeys } from '../../ts/chatShell/messageKeys'
    import { asShellFocus } from '../../ts/chatShell/shellFocus'
    import { ACTION_IDS, type ActionId } from '../../ts/chatShell/actionSlots'
    import { backCloseHandler, registerBackHandler } from '../../ts/backHandlers'
    import { gestureInsetLeft } from '../../ts/android/hostBridge'
    import { hasModuleStubs } from '../../ts/process/moduleRefList'
    import { ensureCurrentModulesOrAlert } from '../../ts/process/moduleEnsure'
    import { getLLMCache } from '../../ts/translator/translator'
    import { isTTSVoiceMode } from '../../ts/process/ttsModes'
    import { alertConfirm, alertError, alertNormal, alertRequestData, alertSelect } from '../../ts/alert'
    import { risuChatParser } from '../../ts/process/scripts'
    import { buildDisplayParseOptions } from '../../ts/process/displayParseOptions'
    import { recordCaughtError } from '../../ts/caughtErrors'
    import ChatBody from '../ChatScreens/ChatBody.svelte'
    import PartialEditController from '../ChatScreens/PartialEditController.svelte'
    import StreamingView from './StreamingView.svelte'
    import MessageEditor from './MessageEditor.svelte'
    import TranslationEditor from './TranslationEditor.svelte'
    import MessageMeta from './MessageMeta.svelte'
    import AlternativesRow from './AlternativesRow.svelte'
    import { chatSurface, isChatSurfaceInstalled } from '../ChatScreens/chatSurface.svelte'
    import { language } from '../../lang'
    import { getCharImage } from '../../ts/characters'
    import { getModelInfo } from '../../ts/model/modellist'
    import { onDestroy, onMount, tick, untrack } from 'svelte'

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
        onOpenActions?: (request: ActionRequest) => void
        // Called when this row goes away while its own action request may still be shown by the host.
        onCloseActions?: (request: ActionRequest) => void
        onOpenCustomize?: (request: CustomizeRequest) => void
        // Reports whether a modal layer of the row (the partial-edit overlays) is open, so the list can lift the row's containment.
        onOverlay?: (open: boolean) => void
    }
    let { idx, message, chatId, name, img = '', character = null, firstMessage = false, expectedId, onBranch, getTreeView, getBusy, onReroll, unReroll, onOpenActions, onCloseActions, onOpenCustomize, onOverlay,
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
    let actionOpener: HTMLElement | null = null
    let statusMessage = $state('')
    let statusTimer: ReturnType<typeof setTimeout> | undefined
    let meta: ReturnType<typeof MessageMeta> | undefined
    let alternatives = $state<ReturnType<typeof AlternativesRow>>()
    let speaking = $state(false)
    let swipe = $state<ReturnType<typeof createSwipeGesture> | null>(null)
    const ownWheel = createWheelSteps(0, 1)
    let pointerType = ''
    let pointerStart = { x: 0, y: 0 }
    let longPressTimer: ReturnType<typeof setTimeout> | undefined
    let longPressRing = $state(false)
    let swipeProgress = $state(0)
    let dragX = $state(0)
    let armed = $state(false)
    let swipeLocked = $state(false)
    let spring = $state(false)
    let commitDirection = $state<'back' | 'forward' | null>(null)
    let commitTimer: ReturnType<typeof setTimeout> | undefined
    let springTimer: ReturnType<typeof setTimeout> | undefined
    const SPRING_DEFAULT_MS = 260
    const SPRING_MARGIN_MS = 150
    let armTimer: ReturnType<typeof setTimeout> | undefined
    let lastSampleAt = { time: 0, wall: 0 }
    let article = $state<HTMLElement | null>(null)
    let lastGenerate = -Infinity
    const ARM_RETRY_MS = 10
    const keys = createMessageKeys()
    let destroyed = false
    let hostedRequest: ActionRequest | null = null
    let overlayOpen = false
    onMount(() => { queueMicrotask(() => { if (!destroyed) iconMounted = true }) })
    // The row that replaced a focused row at the same position takes the focus unless the user has already moved it somewhere else.
    onMount(() => {
        const handover = focusHandover
        if (!handover || handover.idx !== idx || performance.now() > handover.until || !article) return
        focusHandover = null
        const active = document.activeElement
        const previousRow = active?.closest<HTMLElement>('article[data-part="chat-message"]')
        if (!active || active === document.body || (previousRow !== article && previousRow?.dataset.chatIndex === String(idx))) asShellFocus(() => article.focus({ preventScroll: true }))
    })
    // A row that replaced a stepped sibling at the same position reserves the sibling's height until its own body has rendered.
    onMount(() => {
        const handover = heightHandover
        if (!handover || handover.idx !== idx || handover.chatId === chatId || performance.now() > handover.until || !article || !bodyRoot) return
        heightHandover = null
        const row = article
        const body = bodyRoot
        if (bodyRendered(body)) return
        let observer: MutationObserver | undefined
        let timer: ReturnType<typeof setTimeout> | undefined
        const release = () => { observer?.disconnect(); clearTimeout(timer); row.style.minHeight = '' }
        row.style.minHeight = `${handover.height}px`
        if (typeof MutationObserver !== 'undefined') {
            observer = new MutationObserver(() => { if (bodyRendered(body)) release() })
            observer.observe(body, { childList: true, subtree: true, characterData: true })
        }
        timer = setTimeout(release, HEIGHT_FLOOR_MS)
        return release
    })
    // A modal layer of the row (the partial-edit overlays are position: fixed inside the row) must not be clipped by the row's own containment, so the list is told while one is open.
    $effect(() => {
        const partialEditOn = DBState.db.enableBlockPartialEdit || DBState.db.enableDragPartialEdit
        if (!partialEditOn || !article || typeof MutationObserver === 'undefined') return
        const root = article
        const observer = new MutationObserver(() => {
            const open = root.querySelector('.partial-edit-overlay') !== null
            if (open === overlayOpen) return
            overlayOpen = open
            onOverlay?.(open)
        })
        observer.observe(root, { childList: true, subtree: true })
        return () => {
            observer.disconnect()
            if (overlayOpen) { overlayOpen = false; onOverlay?.(false) }
        }
    })
    onDestroy(() => {
        destroyed = true; clearTimeout(longPressTimer); clearTimeout(armTimer); clearTimeout(commitTimer); clearTimeout(springTimer); clearTimeout(statusTimer); unregisterEditorBack(); editor.dispose()
        if (hostedRequest) onCloseActions?.(hostedRequest)
        hostedRequest = null
        if (overlayOpen) onOverlay?.(false)
        overlayOpen = false
    })
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
    // The request-info badge carries the model name on its own line, so the meta row does not repeat it.
    let generationBadgeShown = $derived(Boolean((messageGenerationInfo ?? message.generationInfo) && (DBState.db.requestInfoInsideChat || aiLawApplies())))
    let owner = $derived(DBState.db.characters?.[selIdState.selId])
    let chat = $derived(owner?.chats?.[owner.chatPage])
    let rowOrigin = $derived(owner?.chaId && chat?.id ? originOf(owner, chat) : null)
    let stopDeletePending = $derived(isStopDeletePending(rowOrigin))
    let isBookmarked = $derived(Boolean(chatId && chat?.bookmarks?.includes(chatId)))
    let canSpeak = $derived(idx > -1 && owner?.type !== 'group' && isTTSVoiceMode(owner?.ttsMode))
    let position = $derived(getTreeView?.()?.at(idx) ?? { index: 1, count: 1 })
    let newestCharacter = $derived(message.role === 'char' && idx >= 0 && idx === (chat?.message?.length ?? 0) - 1)
    let userLast = $derived(message.role === 'user' && idx >= 0 && idx === (chat?.message?.length ?? 0) - 1)
    // Every row with more than one alternative shows the pager (older rows only browse); the newest reply keeps its pager and New reply button. Swipe, wheel and the arrow keys act only where a pager is shown.
    let showPager = $derived(idx >= 0 ? newestCharacter || position.count > 1 : firstMessage && position.count > 1)
    // The end control of the last row brings back a continuation that "Branch here" set aside.
    let continuation = $derived(idx >= 0 && idx === (chat?.message?.length ?? 0) - 1 ? getTreeView?.()?.continuation ?? 0 : 0)
    let actions = $derived(ACTION_IDS.filter((id) => id !== 'deleteAfter').filter((id) => idx >= 0 || id === 'copy' || id === 'selectText' || id === 'stepPrev' || id === 'stepNext' || id === 'customizeButtons').filter((id) => id !== 'readAloud' || canSpeak).filter((id) => id !== 'translate' || DBState.db.translator !== '').filter((id) => id !== 'newReply' || newestCharacter).filter((id) => !['stepPrev', 'stepNext'].includes(id) || showPager).filter((id) => id !== 'branch' || onBranch !== undefined))
    let sheetActions = $derived<SheetAction[]>([...actions, 'copyCard', ...(idx >= 0 ? ['hideAbove', 'deleteAfter'] as SheetAction[] : []), ...(idx >= 0 && !streaming && DBState.db.translatorType === 'llm' ? ['retranslate', 'editTranslation'] as SheetAction[] : []), ...(idx >= 0 && !streaming && (DBState.db.enableBlockPartialEdit || DBState.db.enableDragPartialEdit) ? ['partialEdit'] as SheetAction[] : [])])
    let unavailable = $derived(ACTION_IDS.filter((id) => streaming && ['edit', 'translate', 'readAloud', 'branch', 'newReply'].includes(id) || stopDeletePending && (id === 'delete' || id === 'deleteAfter') || getBusy?.() === true && ['stepPrev', 'stepNext', 'newReply'].includes(id)))
    const source = { closeMenu: () => {} }
    function liveIndex(): number { return chatId ? (chat?.message.findIndex((item) => item.chatId === chatId) ?? idx) : idx }
    // The hosting shell shows the sheet outside the transcript; the request keeps every action on this row's live index.
    function openActions(opener: HTMLElement, point?: { x: number; y: number }): void {
        actionOpener = opener
        const request: ActionRequest = { index: idx, opener, anchor: point, available: () => sheetActions, disabled: () => unavailable, generating: () => streaming, run: (id) => { void act(id) } }
        hostedRequest = request
        onOpenActions?.(request)
    }
    // The row's own status line: a copy outcome stays visible for a while and only clears the text it was started for.
    function setStatusMessage(text: string, timeout: number): void {
        clearTimeout(statusTimer)
        statusMessage = text
        statusTimer = setTimeout(() => {
            statusTimer = undefined
            if (statusMessage === text) statusMessage = ''
        }, timeout)
    }
    function reportCopy(outcome: CopyOutcome): void {
        if (destroyed) return
        if ('errorName' in outcome) setStatusMessage(`${outcome.errorName}: ${language.copyFailed}`, 10000)
        else setStatusMessage(language.copied, 3000)
    }
    function reportCard(report: CardReport): void {
        if (destroyed) return
        switch (report.kind) {
            case 'loading': setStatusMessage(language.loading, CARD_DEADLINE_MS + CARD_PENDING_MARGIN_MS); break
            case 'copied': setStatusMessage(language.copied, 3000); break
            case 'simple': setStatusMessage(language.copiedSimpleCard, 5000); break
            case 'text': setStatusMessage(language.copiedAsText, 5000); break
            case 'failed': setStatusMessage(`${report.errorName}: ${language.copyFailed}`, 10000); break
            case 'superseded':
                // A newer copy owns the status; only this card's own loading text is cleared.
                if (statusMessage === language.loading) { clearTimeout(statusTimer); statusTimer = undefined; statusMessage = '' }
                break
        }
    }
    // alertSelect joins its display text and its buttons with "||" and the dialog splits on it again, so message text shown in the
    // display must never carry a "|": a "||" in the excerpt would turn its tail into a button and shift the answer indexes.
    function excerptOf(text: string): string {
        const flat = text.replace(/\s+/g, ' ').trim().replace(/\|/g, '¦')
        return flat.length > 60 ? `${flat.slice(0, 60).trimEnd()}…` : flat
    }
    // A generating reply, or a range that reaches the running send, is stopped first and removed once the send has settled.
    async function removeMessage(mode: DeleteMode): Promise<void> {
        if (!owner || !chat || idx < 0) return
        const target = chat.message[liveIndex()]
        if (!target) return
        const origin = originOf(owner, chat)
        if (origin && isStopDeletePending(origin)) return
        const after = mode === 'from' ? chat.message.length - chat.message.indexOf(target) - 1 : 0
        // Registered trigger, button or tree work is not a generation, and a generation in another chat is not this chat's: only a reply being written inside the range, in this chat, is stopped.
        const sendReachesRange = mode === 'from' && origin !== null && isWriting(origin) && chat.message.slice(chat.message.indexOf(target)).some((item) => isActiveStreamReply(item.chatId))
        if (streaming || sendReachesRange) {
            if (!await alertConfirm(language.chatShellStopDeleteConfirm(after))) return
            if (!requestStopDelete(owner, chat, target, mode)) alertNormal(language.chatShellStopDeleteCannot)
        } else if (mode === 'from') {
            const count = after + 1
            const choice = await alertSelect([language.cancel, language.chatShellDeleteRangeButton(count)], language.chatShellDeleteRangeConfirm(count, excerptOf(target.data)))
            if (choice !== '1') return
            deleteNow(owner, chat, target, 'from')
        } else await requestRemove(owner, chat, target)
    }
    // The first message browses its stored greetings and never generates, and it stops at both ends like the counter does; every other row steps its siblings.
    async function browse(direction: 'back' | 'forward'): Promise<void> {
        if (firstMessage) {
            if (direction === 'back' ? position.index > 1 : position.index < position.count) (direction === 'back' ? unReroll : onReroll)?.()
            return
        }
        if (article && article.contains(document.activeElement)) focusHandover = { idx, until: performance.now() + FOCUS_HANDOVER_MS }
        const height = article?.getBoundingClientRect().height ?? 0
        if (height > 0) heightHandover = { idx, chatId, height, until: performance.now() + FOCUS_HANDOVER_MS }
        await stepSibling(source, liveIndex(), chatId, direction, { generate: false })
        alternatives?.markPageChange()
    }
    // The reply list is rendered newest first, so the message above a row is the later element.
    function messageRows(): HTMLElement[] {
        const list = article?.closest('[data-part="chat-message-list"]')
        return list ? [...list.querySelectorAll<HTMLElement>('article[data-part="chat-message"]')] : []
    }
    function moveFocus(action: 'focusPrev' | 'focusNext' | 'focusFirst' | 'focusLast'): void {
        const rows = messageRows()
        const at = article ? rows.indexOf(article) : -1
        if (at < 0) return
        const target = action === 'focusPrev' ? rows[at + 1] : action === 'focusNext' ? rows[at - 1] : action === 'focusFirst' ? rows[rows.length - 1] : rows[0]
        target?.focus()
    }
    // After a delete the focus stays in the transcript: on the message that follows, or the one before when this was the newest or a range.
    async function removeAndRefocus(mode: DeleteMode): Promise<void> {
        const rows = messageRows()
        const at = article ? rows.indexOf(article) : -1
        const neighbour = at < 0 ? null : mode === 'one' ? rows[at - 1] ?? rows[at + 1] ?? null : rows[at + 1] ?? null
        const mine = article
        await removeMessage(mode)
        await tick()
        const active = document.activeElement
        if (mine && !mine.isConnected && neighbour?.isConnected && (!active || active === document.body || !document.contains(active))) asShellFocus(() => neighbour.focus())
    }
    function generateAfterUser(): void {
        const now = performance.now()
        if (getBusy?.() === true || now - lastGenerate < 500) return
        lastGenerate = now
        void regenerateNewest(source)
    }
    async function act(id: SheetAction): Promise<void> {
        // A row that is gone, or whose message left the chat while the sheet stayed open, has nothing left to act on.
        if (destroyed || (idx >= 0 && liveIndex() < 0)) return
        if ((unavailable as readonly SheetAction[]).includes(id)) return
        switch (id) {
            case 'copy': {
                const selection = window.getSelection()
                const selected = selection && bodyRoot?.contains(selection.anchorNode) && bodyRoot?.contains(selection.focusNode) ? selection.toString() : ''
                copyMessageText(selected || (streaming ? message.data : msgDisplay), reportCopy)
                break
            }
            case 'copyCard': copyMessageAsCard({ owner: message, captureText: () => streaming ? message.data : msgDisplay, report: reportCard, role: () => message.role, name: () => name, messageGenerationInfo: () => message.generationInfo ?? null, idx: liveIndex, getCbsCondition: cbsConditions }); break
            case 'selectText': bodyRoot?.focus(); break
            case 'edit': editor.toggleOriginalEdit(); break
            case 'translate': translated = !translated; break
            case 'retranslate': retranslate = true; translated = true; break
            case 'editTranslation': await editor.loadTranslationForEdit().catch(alertError); break
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
            case 'delete': await removeAndRefocus('one'); break
            case 'deleteAfter': await removeAndRefocus('from'); break
            case 'stepPrev': await browse('back'); break
            case 'stepNext': await browse('forward'); break
            case 'newReply': alternatives?.requestNewReply(); break
            case 'customizeButtons': onOpenCustomize?.({ opener: actionOpener, onchange: () => meta?.refresh() }); break
        }
    }
    const unregisterEditorBack = registerBackHandler(backCloseHandler({
        isOpen: () => editor.editMode || editor.editTranslationMode,
        snapshot: () => `${editor.editMode}:${editor.editTranslationMode}:${editor.discardConfirmOpen}`,
        close: () => { if (editor.editTranslationMode) editor.closeTranslationKeep(); else void editor.requestDiscardOriginalEdit() },
    }))
    const HOST_INSET_PROBE_PX = 64
    // The host reports one inset and the edge zones apply it on both sides, so it is read near either edge.
    function readHostInset(xPx: number): number {
        const reach = HOST_INSET_PROBE_PX + EDGE_ZONE_DP
        if (xPx > reach && xPx < window.innerWidth - reach) return 0
        try {
            const value: unknown = gestureInsetLeft()
            return typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, 0), HOST_INSET_PROBE_PX) : 0
        } catch { return 0 }
    }
    // A wide table or code block scrolls sideways by itself: a drag that starts inside one belongs to it, not to the swipe.
    function startsInHorizontalScroller(target: HTMLElement): boolean {
        const body = target.closest<HTMLElement>('[data-part="chat-message-body"]')
        for (let node: HTMLElement | null = target; node && node !== body; node = node.parentElement) {
            if (node.scrollWidth > node.clientWidth) return true
        }
        return false
    }
    function sample(event: PointerEvent) { return { x: event.clientX, y: event.clientY, time: event.timeStamp } }
    function onPointerDown(event: PointerEvent): void {
        if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return
        const target = event.target as HTMLElement
        if (target.closest('button, a, input, textarea, [contenteditable]')) return
        pointerType = event.pointerType
        pointerStart = { x: event.clientX, y: event.clientY }
        clearTimeout(springTimer)
        spring = false
        const edge = classifyEdge({ xPx: event.clientX, viewportWidthPx: window.innerWidth, dpPerPx: 1, hostInsetDp: readHostInset(event.clientX), rtl: document.dir === 'rtl' }) === 'edge'
        swipe = createSwipeGesture({ widthPx: bodyRoot?.clientWidth ?? 320, dpPerPx: 1, index: position.index - 1, count: position.count, edge: edge || startsInHorizontalScroller(target), streaming, firstMessage, canGenerate: newestCharacter, enabled: DBState.db.swipe && showPager, pointerType: event.pointerType })
        swipe.down(sample(event))
        clearTimeout(longPressTimer)
        const opener = event.currentTarget as HTMLElement
        longPressTimer = setTimeout(() => { if (swipe) { swipe.cancel(); longPressRing = false; openActions(opener, pointerStart) } }, 500)
        setTimeout(() => { if (longPressTimer) longPressRing = true }, 200)
    }
    // The body follows the finger one to one where a reply exists, pulls with resistance toward a new reply, and stops at a rubber band where nothing can happen.
    function dragFor(delta: number): number {
        const distance = Math.abs(delta)
        const hasTarget = delta > 0 ? position.index > 1 : position.index < position.count
        const pulls = delta < 0 && position.index >= position.count && newestCharacter && !firstMessage
        if (streaming || !(hasTarget || pulls)) return Math.sign(delta) * RUBBER_BAND_PX * (1 - Math.exp(-distance / (RUBBER_BAND_PX * 4)))
        const easy = (bodyRoot?.clientWidth ?? 320) * 0.4
        return Math.sign(delta) * (Math.min(distance, easy) + Math.max(0, distance - easy) * 0.35)
    }
    function onPointerMove(event: PointerEvent): void {
        if (!swipe) return
        spring = false
        if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 10) { clearTimeout(longPressTimer); longPressTimer = undefined; longPressRing = false }
        const stamp = sample(event)
        lastSampleAt = { time: stamp.time, wall: performance.now() }
        const result = swipe.move(stamp)
        swipeProgress = result.progress
        swipeLocked = result.locked
        armed = result.armed
        if (result.locked) dragX = dragFor(event.clientX - pointerStart.x)
        if (result.event === 'arm') tickHaptic('arm', pointerType, readHaptics())
        // A finger that holds still sends no more events, so the arm is re-evaluated when the hold time has passed.
        clearTimeout(armTimer)
        armTimer = setTimeout(onArmTimer, ARM_HOLD_MS)
    }
    function onArmTimer(): void {
        armTimer = undefined
        if (!swipe) return
        const result = swipe.tick(lastSampleAt.time + (performance.now() - lastSampleAt.wall))
        swipeProgress = result.progress
        armed = result.armed
        if (result.event === 'arm') tickHaptic('arm', pointerType, readHaptics())
        // A timer that fires a hair before the hold has fully passed looks again shortly instead of leaving a still finger unarmed.
        else if (!result.armed && result.progress >= 0.7) armTimer = setTimeout(onArmTimer, ARM_RETRY_MS)
    }
    // The new content slides in from the side the swipe came from; a release that commits nothing springs back.
    function commitSlide(direction: 'back' | 'forward'): void {
        clearTimeout(commitTimer)
        commitDirection = direction
        commitTimer = setTimeout(() => { commitDirection = null }, 1000)
    }
    function finishSwipe(result: SwipeResult): void {
        clearTimeout(longPressTimer); longPressTimer = undefined; longPressRing = false
        clearTimeout(armTimer); armTimer = undefined
        const wasDragged = dragX !== 0
        swipe = null; swipeProgress = 0; dragX = 0; armed = false; swipeLocked = false
        if (result.event === 'stepPrev' || result.event === 'stepNext') {
            commitSlide(result.event === 'stepPrev' ? 'back' : 'forward')
            tickHaptic('commit', pointerType, readHaptics())
            void act(result.event === 'stepPrev' ? 'stepPrev' : 'stepNext')
        } else if (result.event === 'generate') {
            // The pulled body springs back to the centre while the new reply starts.
            startSpring(wasDragged)
            alternatives?.requestNewReply()
        } else startSpring(wasDragged)
    }
    // The spring exists only for a body that was displaced and only where motion is allowed; a timer owns its end so a missing transitionend never leaves a transform behind.
    function startSpring(wasDragged: boolean): void {
        clearTimeout(springTimer)
        if (!wasDragged || motionReduced()) { spring = false; return }
        spring = true
        springTimer = setTimeout(() => { spring = false }, springDurationMs() + SPRING_MARGIN_MS)
    }
    function motionReduced(): boolean {
        if (document.documentElement.classList.contains('rm')) return true
        return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    }
    function springDurationMs(): number {
        // The nominal slow duration times the unitless motion factor the page sets on the root; the same product the CSS token computes.
        const factor = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chat-motion'))
        return SPRING_DEFAULT_MS * (Number.isFinite(factor) ? Math.min(10, Math.max(0, factor)) : 1)
    }
    // The body and the alternatives row both belong to the message; they are siblings, so one event reaches exactly one of them.
    function onWheel(event: WheelEvent): void {
        if (!showPager) return
        const host = article?.closest('[data-part="chat-message-list"]') ?? null
        let wheel = host ? wheelByList.get(host) : undefined
        if (!wheel) {
            wheel = host ? createWheelSteps(0, 1) : ownWheel
            if (host) wheelByList.set(host, wheel)
        }
        wheel.set(position.index - 1, position.count)
        const result = wheel({ dx: event.deltaX, dy: event.deltaY, time: event.timeStamp, shiftKey: event.shiftKey })
        if (result === 'stepPrev' || result === 'stepNext') { event.preventDefault(); void act(result === 'stepPrev' ? 'stepPrev' : 'stepNext') }
    }
    function onMessageKey(event: KeyboardEvent): void {
        const reroll = event.ctrlKey && event.altKey && event.key.toLowerCase() === 'r'
        if (event.target !== event.currentTarget && !reroll) return
        const action = keys.handle(event, { focus: 'message', index: position.index - 1, count: showPager ? position.count : 1, newestCharacter, firstMessage, now: performance.now() })
        // The newest reply owns Ctrl+Alt+R, whether or not the press acts, so the global hotkey does not click a second control.
        if (reroll && (newestCharacter || firstMessage)) { event.preventDefault(); event.stopPropagation() }
        if (action === 'openActions') { event.preventDefault(); openActions(event.currentTarget as HTMLElement) }
        else if (action === 'focusPrev' || action === 'focusNext' || action === 'focusFirst' || action === 'focusLast') { event.preventDefault(); moveFocus(action) }
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

<!-- The article keeps the transcript semantics and is a tab stop and the focus target of message navigation, so its key and context-menu events and the captured clicks and submits of rich message content must reach it; the swipe gesture listens on the body. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
<article class="risu-chat" class:user={message.role === 'user'} data-part="chat-message" data-role={message.role} data-run={firstMessage ? 'single' : run} data-meta="shown" data-streaming={streaming ? '' : undefined} data-hidden={disabled ? '' : undefined} data-bookmarked={isBookmarked ? '' : undefined} data-chat-index={idx} data-chat-id={chatId ?? ''} aria-labelledby={labelId} tabindex="0" bind:this={article} onclickcapture={(event) => handleButtonTriggerWithin(event, liveIndex)} onsubmitcapture={(event) => handleFormTriggerWithin(event, liveIndex)} onkeydown={onMessageKey} oncontextmenu={(event) => { if (!window.getSelection()?.toString() || event.shiftKey) { event.preventDefault(); openActions(event.currentTarget, { x: event.clientX, y: event.clientY }) } }}>
    {#if disabled === true}<div data-part="chat-message-divider" data-kind="disabled"></div>{/if}
    <div data-part="chat-message-name-row">
        <div data-part="chat-message-meta">
            {#if !$HideIconStore && iconMounted}
                {#if avatar}<img data-part="chat-message-avatar" data-round={DBState.db.roundIcons ? '' : undefined} src={avatar} alt="" onerror={() => { avatar = null }} />
                {:else}<span data-part="chat-message-avatar" data-round={DBState.db.roundIcons ? '' : undefined} aria-hidden="true">{name.slice(0, 1)}</span>{/if}
            {/if}
            <span data-part="chat-message-name" id={labelId}>{name}</span>
            {#if isBookmarked}<span data-part="chat-message-badges" aria-label={language.bookmark}>★</span>{/if}
            <MessageMeta bind:this={meta} {name} time={message.time} model={generationBadgeShown ? '' : modelShortName} available={actions} disabled={unavailable} generating={streaming} onaction={(id, shiftKey) => { void act(id === 'delete' && shiftKey ? 'deleteAfter' : id) }} onmore={openActions} />
        </div>
    </div>
    {#if generationBadgeShown}
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
    <div data-part="chat-message-body" class="text chat-width chattext prose minw-0" class:prose-invert={$ColorSchemeTypeStore} style:font-size={`${0.875 * ((DBState.db.zoomsize ?? 100) / 100)}rem`} style:line-height={`${(DBState.db.lineHeight ?? 1.25) * ((DBState.db.zoomsize ?? 100) / 100)}rem`} bind:this={bodyRoot} style:transform={dragX !== 0 || spring ? `translateX(${dragX}px)` : undefined} style:touch-action="pan-y" data-spring={spring ? '' : undefined} data-commit={commitDirection ?? undefined} onanimationend={() => { commitDirection = null }} ontransitionend={() => { spring = false }} onpointerdown={onPointerDown} onpointermove={onPointerMove} onpointerup={(event) => { if (swipe) finishSwipe(swipe.up(sample(event))) }} onpointercancel={() => { if (swipe) finishSwipe(swipe.cancel()) }} onwheel={onWheel} onclick={() => { if (DBState.db.clickToEdit && idx >= 0 && !streaming) editor.startOriginalEdit() }}>
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
    {#if swipeLocked && streaming}<span data-part="chat-swipe-arm" role="status">{language.chatShellStillWriting}</span>
    {:else if swipeProgress > 0}<span data-part="chat-swipe-arm" role="status" style:opacity={swipeProgress}>{armed ? language.chatShellReleaseNewReply : language.chatShellNoSavedReplies}</span>{/if}
    {#if userLast && !streaming}<button type="button" data-part="chat-generate-reply" disabled={getBusy?.() === true} onclick={generateAfterUser}>⟳ {language.chatShellGenerateReply}</button>{/if}
    {#if showPager || continuation > 0}
        <AlternativesRow bind:this={alternatives} {idx} {expectedId} index={position.index} count={position.count} {firstMessage} pager={showPager} browseOnly={!newestCharacter && !firstMessage} {continuation} busy={getBusy?.() ?? false} onwheel={onWheel} onStep={firstMessage ? (direction) => { void browse(direction) } : undefined} />
    {/if}
    {#if statusMessage}<span data-part="chat-status-row" role="status" aria-live="polite">{statusMessage}</span>{/if}
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
    [data-part="chat-message-name"] { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    [data-part="chat-message-generation-info"] { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    [data-part="chat-message-avatar"] { display: inline-flex; align-items: center; justify-content: center; width: var(--size-avatar-sm); height: var(--size-avatar-sm); border-radius: var(--radius-circle); background: var(--nexus-surface-raised); }
    [data-part="chat-message-avatar"]:not([data-round]) { border-radius: var(--radius-4); }
    [data-part="chat-message-body"] { max-width: var(--thread-max-width); width: 100%; overflow-wrap: anywhere; }
    [data-part="chat-message"].user { border-left: var(--stroke-bold) solid var(--nexus-edge-strong); }
    [data-part="chat-message-body"][data-spring] { transition: transform var(--chat-dur-slow) var(--chat-ease-spring); }
    [data-part="chat-message-body"][data-commit="forward"] { animation: commit-in-forward var(--chat-dur-base) var(--chat-ease-out) both; }
    [data-part="chat-message-body"][data-commit="back"] { animation: commit-in-back var(--chat-dur-base) var(--chat-ease-out) both; }
    [data-part="chat-swipe-arm"], [data-part="chat-generate-reply"] { color: var(--nexus-text-secondary); font-size: var(--font-size-xs); }
    @keyframes commit-in-forward { from { transform: translateX(var(--swipe-nudge)); opacity: var(--opacity-half); } }
    @keyframes commit-in-back { from { transform: translateX(calc(-1 * var(--swipe-nudge))); opacity: var(--opacity-half); } }
    @keyframes commit-fade { from { opacity: var(--opacity-half); } }
    @media (prefers-reduced-motion: reduce) {
        [data-part="chat-message-body"][data-spring] { transition: none; }
        [data-part="chat-message-body"][data-commit] { animation: commit-fade var(--chat-dur-fast) var(--chat-ease-out) both; }
    }
    :global(html.rm) [data-part="chat-message-body"][data-spring] { transition: none; }
    :global(html.rm) [data-part="chat-message-body"][data-commit] { animation: commit-fade var(--chat-dur-fast) var(--chat-ease-out) both; }
    :global(html[data-low-power]) [data-part="chat-message-body"][data-spring] { transition-duration: var(--dur-lowpower-cap); }
    :global(html[data-low-power]) [data-part="chat-message-body"][data-commit] { animation-duration: var(--dur-lowpower-cap); }
    [data-part="chat-message-interrupted"] { color: var(--nexus-text-secondary); font-style: italic; font-size: var(--font-size-xs); }
    [data-part="chat-status-row"] { color: var(--nexus-text-secondary); font-size: var(--font-size-xs); }
    [data-part="chat-message-delete-pending"] { color: var(--nexus-text-secondary); font-style: italic; font-size: var(--font-size-xs); }
    [data-part="chat-message-render-failed"] { color: var(--nexus-text-secondary); font-style: italic; font-size: var(--font-size-xs); }
    [data-part="chat-message-divider"] { border-top: var(--stroke-bold) dashed var(--color-warning); }
    [data-part="chat-message-divider"][data-kind="disabled"] { border-top-color: var(--color-accent); }
    [data-part="chat-message-memory-limit"] { border-top-style: solid; border-top-color: var(--color-accent); }
    button { color: var(--nexus-text-secondary); }
</style>
