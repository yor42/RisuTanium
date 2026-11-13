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
    // `control` names the pager or action control that held focus, so the successor focuses the same control when it can.
    let focusHandover: { idx: number; until: number; control: string | null } | null = null
    // The successor of a stepped row has no rendered body yet; it keeps the predecessor's height until the body arrives or this many milliseconds pass, so the transcript never collapses under the reader.
    const HEIGHT_FLOOR_MS = 1500
    let heightHandover: { idx: number; chatId: string | undefined; height: number; until: number } | null = null
    // A swipe that commits where motion is reduced or power is low steps the row, which mounts a successor under a new key; the commit animation belongs to the element that stays in the document, so the successor takes it.
    // It is taken at most once, only by the row that replaces the stepped one at the same position, and only while the window is open: a body that renders later gets no fade.
    const COMMIT_HANDOVER_MS = HEIGHT_FLOOR_MS
    let commitHandover: { idx: number; chatId: string | undefined; direction: 'back' | 'forward'; until: number; mark: boolean } | null = null
    // The pending body is empty or one of ChatBody's loading indicators (the parse placeholder with role="status", the translation spinner with its animated element); anything else is the rendered message.
    function bodyRendered(body: HTMLElement): boolean {
        if (body.querySelector('[role="status"], [style*="animation: spin"]') !== null) return false
        return (body.textContent ?? '').trim() !== '' || body.querySelector('*') !== null
    }
    // A swipe starts only where the nearest part of the row is one of the message's own parts. Editors, modal layers, the pager and the end row, and anything rendered into the row later, are not listed, so they start nothing until they are named here.
    const SWIPE_START_PARTS: ReadonlySet<string> = new Set([
        'chat-message', 'chat-message-name-row', 'chat-message-meta', 'chat-message-name', 'chat-message-avatar', 'chat-message-badges',
        'chat-message-stage', 'chat-message-body', 'chat-streaming-view', 'chat-stream-finished', 'chat-stream-open', 'chat-stream-thinking',
        'chat-swipe-peek', 'chat-swipe-peek-chip', 'chat-swipe-peek-text', 'chat-swipe-meter', 'chat-swipe-arm', 'chat-swipe-commit-mark', 'chat-long-press-ring',
        'chat-status-row', 'chat-message-delete-pending', 'chat-message-render-failed', 'chat-message-interrupted', 'chat-message-memory-limit', 'chat-message-divider',
    ])
    // Inside an allowed part these keep their own touch behaviour (taps, text entry, media controls, sliders, the pager and the end control).
    const SWIPE_INTERACTIVE = 'a, button, input, textarea, select, summary, label, [contenteditable], audio[controls], video[controls], [role="button"], [role="link"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="slider"], [role="scrollbar"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="option"], [role="combobox"], [role="textbox"], [role="spinbutton"], [data-part="chat-message-alts"], [data-part="chat-message-end"]'
    // The control inside the row that has focus, as a selector the successor row can resolve; null when the row itself or nothing in it has focus.
    function focusedControl(row: HTMLElement): string | null {
        const active = document.activeElement
        if (!(active instanceof HTMLElement) || active === row || !row.contains(active)) return null
        const { step, action } = active.dataset
        if (step !== undefined && /^\w+$/.test(step)) return `[data-step="${step}"]`
        if (action !== undefined && /^\w+$/.test(action)) return `[data-action="${action}"]`
        return null
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
    import { shellGenerationSource } from '../../ts/chatShell/sendFailure.svelte'
    import { originOf, isWriting } from '../../ts/process/chatOrigin'
    import { isActiveStreamReply } from '../../ts/process/activeStreams'
    import { requestStopDelete, isStopDeletePending } from '../../ts/chatShell/stopDelete.svelte'
    import type { CopyOutcome } from '../../ts/chatCopy'
    import { CARD_DEADLINE_MS, CARD_PENDING_MARGIN_MS, type CardReport } from '../../ts/chatCard'
    import { createSwipeGesture, createWheelSteps, meterFill, peekNeighbour, peekText, ARM_HOLD_MS, RUBBER_BAND_PX, type SwipeResult, type WheelSteps } from '../../ts/chatShell/swipeGesture'
    import { lowPowerMarked } from '../../ts/chatShell/lowPower'
    import { siblingsAt } from '../../ts/process/chatTree'
    import { RefreshCwIcon } from '@lucide/svelte'
    import { inFollowOpenZone, INSET_MAX_CSS, INSET_PROBE_MAX_CSS } from '../SideBars/panelGesture'
    import { tickHaptic, readHaptics } from '../../ts/chatShell/haptics'
    import { reducedMotionActive } from '../../ts/chatShell/motionPrefs.svelte'
    import { createMessageKeys } from '../../ts/chatShell/messageKeys'
    import { asShellFocus } from '../../ts/chatShell/shellFocus'
    import type { StepRowRunner } from '../../ts/chatShell/stepHold'
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
    import { isAndroidTransport } from '../../ts/storage/tauriByteTransport'
    import { getModelInfo } from '../../ts/model/modellist'
    import { onDestroy, onMount, untrack } from 'svelte'
    import { afterFlush } from '../../ts/afterFlush'

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
        // Runs an alternative step for this row inside the list's hold; a row mounted on its own runs the step directly.
        stepRow?: StepRowRunner
        onBranch?: (index: number, expectedId: string | undefined) => void
        getTreeView?: () => TreeView | null
        // The raw text of the alternative at a 1-based position, for rows whose alternatives are not chat siblings (the first message's greetings).
        neighbourText?: (index: number) => string | null
        getBusy?: () => boolean
        onOpenActions?: (request: ActionRequest) => void
        // Called when this row goes away while its own action request may still be shown by the host.
        onCloseActions?: (request: ActionRequest) => void
        onOpenCustomize?: (request: CustomizeRequest) => void
        // Reports whether a modal layer of the row (the partial-edit overlays) is open, so the list can lift the row's containment.
        onOverlay?: (open: boolean) => void
    }
    let { idx, message, chatId, name, img = '', character = null, firstMessage = false, expectedId, stepRow, onBranch, getTreeView, neighbourText, getBusy, onReroll, unReroll, onOpenActions, onCloseActions, onOpenCustomize, onOverlay,
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
    // Swipe feedback (SLICE1_SPEC §3.2): the neighbour that peeks in, the slide-out that lands a step, the meter and the long-press ring.
    let stage = $state<HTMLElement | null>(null)
    let peek = $state<{ index: number, from: 'left' | 'right', text: string } | null>(null)
    let settle = $state(false)
    // Set from the start of a slide-out until its step has landed; every other step of the row waits it out.
    let settling: { direction: 'back' | 'forward', index: number } | null = null
    let settleTimer: ReturnType<typeof setTimeout> | undefined
    let gestureStepped = $state(false)
    let lowPowerGesture = $state(false)
    let ringAt = $state<{ x: number, y: number } | null>(null)
    const PEEK_GAP_PX = 16
    const ARM_POLL_MS = 16
    const METER_RING = 2 * Math.PI * 15
    let spring = $state(false)
    let commitDirection = $state<'back' | 'forward' | null>(null)
    let commitTimer: ReturnType<typeof setTimeout> | undefined
    let commitMark = $state(false)
    let markTimer: ReturnType<typeof setTimeout> | undefined
    const MARK_FALLBACK_MS = 2000
    let springTimer: ReturnType<typeof setTimeout> | undefined
    const SPRING_DEFAULT_MS = 260
    const SPRING_MARGIN_MS = 150
    let armTimer: ReturnType<typeof setTimeout> | undefined
    let lastSampleAt = { time: 0, wall: 0 }
    let article = $state<HTMLElement | null>(null)
    let lastGenerate = -Infinity
    const keys = createMessageKeys()
    let destroyed = false
    let hostedRequest: ActionRequest | null = null
    let overlayOpen = false
    onMount(() => { queueMicrotask(() => { if (!destroyed) iconMounted = true }) })
    // The row that replaced a focused row at the same position takes the focus unless the user has already moved it somewhere else.
    // It focuses the control that had it (a pager arrow) when the successor has that control enabled, else the row itself.
    onMount(() => {
        const handover = focusHandover
        if (!handover || handover.idx !== idx || performance.now() > handover.until || !article) return
        focusHandover = null
        const active = document.activeElement
        const previousRow = active?.closest<HTMLElement>('article[data-part="chat-message"]')
        if (!active || active === document.body || (previousRow !== article && previousRow?.dataset.chatIndex === String(idx))) {
            const control = handover.control === null ? null : article.querySelector<HTMLElement>(handover.control)
            const enabled = control !== null && !(control instanceof HTMLButtonElement && control.disabled) && control.getAttribute('aria-disabled') !== 'true'
            asShellFocus(() => (enabled ? control : article).focus({ preventScroll: true }))
        }
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
    // The successor of a row stepped by a committed swipe shows the commit animation once its own body has rendered, so the fade never plays on an empty body.
    onMount(() => {
        const handover = commitHandover
        if (!handover || handover.idx !== idx || handover.chatId === chatId || performance.now() > handover.until || !bodyRoot) return
        commitHandover = null
        const body = bodyRoot
        if (bodyRendered(body)) { commitSlide(handover.direction, handover.mark); return }
        let observer: MutationObserver | undefined
        let timer: ReturnType<typeof setTimeout> | undefined
        const stop = () => { observer?.disconnect(); clearTimeout(timer) }
        if (typeof MutationObserver === 'undefined') return
        observer = new MutationObserver(() => {
            if (!bodyRendered(body)) return
            stop()
            if (performance.now() <= handover.until) commitSlide(handover.direction, handover.mark)
        })
        observer.observe(body, { childList: true, subtree: true, characterData: true })
        timer = setTimeout(stop, Math.max(0, handover.until - performance.now()))
        return stop
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
        destroyed = true; clearTimeout(longPressTimer); clearTimeout(armTimer); clearTimeout(settleTimer); clearTimeout(commitTimer); clearTimeout(markTimer); clearTimeout(springTimer); clearTimeout(statusTimer); unregisterEditorBack(); editor.dispose()
        if (hostedRequest) onCloseActions?.(hostedRequest)
        hostedRequest = null
        if (overlayOpen) onOverlay?.(false)
        overlayOpen = false
    })
    $effect(() => {
        let live = true
        avatar = null
        // On Android the signal holds a large avatar in the whole-read queue until this run ends; a run that ends
        // first gives its place back without a read. Off Android the call stays the two-argument one.
        const hold = isAndroidTransport() ? new AbortController() : null
        if (iconMounted) Promise.resolve(img).then((source) => hold ? getCharImage(source, 'plain', { signal: hold.signal }) : getCharImage(source, 'plain'))
            .then((value) => { if (live && typeof value === 'string') avatar = value })
            .catch(() => { if (live) avatar = null })
        return () => { live = false; hold?.abort() }
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
    // Hidden names drop the avatar and the visible name; the name stays in the tree so the row keeps its accessible name.
    let namesHidden = $derived(chat?.hideNames === true)
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
    const source = shellGenerationSource(() => {})
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
    // Every step of this row, from the pager, a swipe, the wheel, a key or the sheet, runs inside the list's hold when there is one.
    async function holdStep(step: () => Promise<void> | void): Promise<void> {
        if (stepRow) await stepRow(idx, step)
        else await step()
    }
    async function browse(direction: 'back' | 'forward'): Promise<void> {
        if (settling) return
        await stepNow(direction)
    }
    async function stepNow(direction: 'back' | 'forward'): Promise<void> {
        if (firstMessage) {
            if (direction === 'back' ? position.index > 1 : position.index < position.count) await holdStep(() => (direction === 'back' ? unReroll : onReroll)?.())
            return
        }
        if (article && article.contains(document.activeElement)) focusHandover = { idx, until: performance.now() + FOCUS_HANDOVER_MS, control: focusedControl(article) }
        const height = article?.getBoundingClientRect().height ?? 0
        if (height > 0) heightHandover = { idx, chatId, height, until: performance.now() + FOCUS_HANDOVER_MS }
        await holdStep(() => stepSibling(source, liveIndex(), chatId, direction, { generate: false }))
        alternatives?.markPageChange()
    }
    // The end control brings back a detached continuation; its row stays where it is, so the same hold applies.
    async function bringBackContinuation(): Promise<void> {
        if (settling) return
        await holdStep(() => stepSibling(source, idx + 1, expectedId, 'back', { generate: false }))
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
        await afterFlush()
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
        if (settling && (id === 'stepPrev' || id === 'stepNext' || id === 'newReply')) return
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
    // The inset is clamped exactly as the sidebar's gesture clamps it, so both agree on where its opening strip starts.
    function readHostInset(): number {
        try {
            const value: unknown = gestureInsetLeft()
            return typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, 0), INSET_MAX_CSS) : 0
        } catch { return 0 }
    }
    // The direction is read from the same two sources as the sidebar's gesture, so a start is never claimed by both.
    function documentRtl(): boolean {
        const root = document.documentElement
        return root.dir === 'rtl' || getComputedStyle(root).direction === 'rtl'
    }
    // The swipe yields exactly where the sidebar's follow-mode gesture opens: the host is asked only for a start inside the sidebar's probe window, as the sidebar does.
    function drawerOwnsStart(xPx: number): boolean {
        const rtl = documentRtl()
        const nearEdge = rtl ? xPx > window.innerWidth - INSET_PROBE_MAX_CSS : xPx < INSET_PROBE_MAX_CSS
        return nearEdge && inFollowOpenZone({ xPx, viewportWidthPx: window.innerWidth, dpPerPx: 1, hostInsetDp: readHostInset(), rtl })
    }
    // A wide table or code block scrolls sideways by itself: a drag that starts inside one belongs to it, not to the swipe. A start outside the body has no scroller of its own, so the walk never climbs above the article.
    function startsInHorizontalScroller(target: HTMLElement): boolean {
        const body = target.closest<HTMLElement>('[data-part="chat-message-body"]')
        if (body === null) return false
        for (let node: HTMLElement | null = target; node && node !== body; node = node.parentElement) {
            if (node.scrollWidth > node.clientWidth) return true
        }
        return false
    }
    function sample(event: PointerEvent) { return { x: event.clientX, y: event.clientY, time: event.timeStamp } }
    // A step remounts the row, which would destroy an open editor and its unsaved text, so no phase of a gesture runs while one is open.
    function swipeBlocked(): boolean {
        return editor.editMode || editor.editTranslationMode || overlayOpen
    }
    // Content with no part of its own belongs to the part that holds it, except directly under the article, where only the article's own padding counts: a layer rendered into the row without a part must not inherit the row.
    function startsInOwnPart(target: HTMLElement): boolean {
        const owner = target.closest('[data-part]')
        if (owner === null || article === null || !article.contains(owner)) return false
        if (owner === article && target !== article) return false
        return SWIPE_START_PARTS.has(owner.getAttribute('data-part') ?? '')
    }
    function onPointerUp(event: PointerEvent): void {
        if (swipe) finishSwipe(swipeBlocked() ? swipe.cancel() : swipe.up(sample(event)))
    }
    function onPointerDown(event: PointerEvent): void {
        if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return
        if (swipeBlocked()) return
        if (settling) return
        const target = event.target as HTMLElement
        if (!startsInOwnPart(target)) return
        const interactive = target.closest(SWIPE_INTERACTIVE)
        if (interactive !== null && article?.contains(interactive)) return
        pointerType = event.pointerType
        pointerStart = { x: event.clientX, y: event.clientY }
        clearTimeout(springTimer)
        spring = false
        peek = null
        gestureStepped = reducedMotionActive() || lowPowerMarked()
        lowPowerGesture = lowPowerMarked()
        const box = stage?.getBoundingClientRect()
        ringAt = box ? { x: event.clientX - box.left, y: event.clientY - box.top } : null
        commitMark = false
        clearTimeout(markTimer)
        const edge = drawerOwnsStart(event.clientX)
        swipe = createSwipeGesture({ widthPx: bodyRoot?.clientWidth ?? 320, dpPerPx: 1, index: position.index - 1, count: position.count, edge: edge || startsInHorizontalScroller(target), streaming, firstMessage, canGenerate: newestCharacter, enabled: DBState.db.swipe && showPager, pointerType: event.pointerType })
        swipe.down(sample(event))
        clearTimeout(longPressTimer)
        const opener = bodyRoot ?? (event.currentTarget as HTMLElement)
        longPressTimer = setTimeout(() => { if (swipe) { swipe.cancel(); clearTimeout(armTimer); armTimer = undefined; longPressRing = false; peek = null; openActions(opener, pointerStart) } }, 500)
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
        if (swipeBlocked()) { finishSwipe(swipe.cancel()); return }
        spring = false
        if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 10) { clearTimeout(longPressTimer); longPressTimer = undefined; longPressRing = false }
        const stamp = sample(event)
        lastSampleAt = { time: stamp.time, wall: performance.now() }
        const result = swipe.move(stamp)
        swipeProgress = result.progress
        swipeLocked = result.locked
        armed = result.armed
        if (result.locked) dragX = dragFor(event.clientX - pointerStart.x)
        updatePeek(result.locked)
        if (result.event === 'arm') tickHaptic('arm', pointerType, readHaptics())
        // A finger that holds still sends no more events: past the arm distance the hold is polled so the meter fills and arms on time; otherwise it is looked at again when the hold time has passed.
        clearTimeout(armTimer)
        armTimer = setTimeout(onArmTimer, holding(result) ? nextPollMs(result.progress) : ARM_HOLD_MS)
    }
    function onArmTimer(): void {
        armTimer = undefined
        if (!swipe) return
        const result = swipe.tick(lastSampleAt.time + (performance.now() - lastSampleAt.wall))
        swipeProgress = result.progress
        armed = result.armed
        if (result.event === 'arm') tickHaptic('arm', pointerType, readHaptics())
        else if (holding(result)) armTimer = setTimeout(onArmTimer, nextPollMs(result.progress))
    }
    // A pull held past the arm distance and not armed yet: the meter's last 30 % is the hold.
    function holding(result: SwipeResult): boolean {
        return !result.armed && result.progress >= 0.7
    }
    // The next look at a held pull: one frame, or exactly when the hold completes if that is sooner, so the arm is never late.
    function nextPollMs(progress: number): number {
        return Math.max(1, Math.min(ARM_POLL_MS, Math.floor((1 - progress) / 0.3 * ARM_HOLD_MS)))
    }
    // The neighbour that peeks in is looked up once per direction of a gesture, as plain text.
    function updatePeek(locked: boolean): void {
        if (!locked || settling) return
        const neighbour = peekNeighbour(dragX, position.index, position.count, streaming)
        if (neighbour === null) { peek = null; return }
        if (peek?.index === neighbour) return
        peek = { index: neighbour, from: neighbour > position.index ? 'right' : 'left', text: lowPowerGesture ? '' : neighbourTextOf(neighbour) }
    }
    function neighbourTextOf(index: number): string {
        if (neighbourText) return peekText(neighbourText(index) ?? '')
        if (idx < 0 || !chat) return ''
        return peekText(siblingsAt(chat, idx)[index - 1]?.data ?? '')
    }
    // The new content slides in from the side the swipe came from; a release that commits nothing springs back.
    // A commit mark is a still outline that outlives the slide's own animation, so it is a sibling of the body and has its own fallback clear.
    function commitSlide(direction: 'back' | 'forward', mark: boolean): void {
        clearTimeout(commitTimer)
        commitDirection = direction
        commitTimer = setTimeout(() => { commitDirection = null }, 1000)
        if (!mark) return
        clearTimeout(markTimer)
        commitMark = true
        markTimer = setTimeout(() => { commitMark = false }, MARK_FALLBACK_MS)
    }
    function finishSwipe(result: SwipeResult): void {
        clearTimeout(longPressTimer); longPressTimer = undefined; longPressRing = false
        clearTimeout(armTimer); armTimer = undefined
        const wasDragged = dragX !== 0
        swipe = null; swipeProgress = 0; armed = false; swipeLocked = false
        if (result.event === 'stepPrev' || result.event === 'stepNext') {
            const direction = result.event === 'stepPrev' ? 'back' : 'forward'
            // A step the row cannot take right now (a reply is being generated) is not committed: the body springs back.
            if ((unavailable as readonly SheetAction[]).includes(result.event)) { dragX = 0; startSpring(wasDragged); return }
            tickHaptic('commit', pointerType, readHaptics())
            // Where motion is reduced or power is low the step lands at once with the crossfade; otherwise the body slides out while the neighbour settles, and the step lands after.
            const reduced = reducedMotionActive()
            if (reduced || lowPowerMarked()) {
                dragX = 0
                peek = null
                commitSlide(direction, reduced)
                // The first message never remounts and keeps its own commit above. Any other row hands the animation to its successor, and a step that mounts none leaves nothing behind for a later row.
                const handover: typeof commitHandover = firstMessage ? null : { idx, chatId, direction: result.event === 'stepPrev' ? 'back' : 'forward', until: performance.now() + COMMIT_HANDOVER_MS, mark: reduced }
                if (handover) commitHandover = handover
                void act(result.event).finally(() => { if (handover && commitHandover === handover) commitHandover = null })
            } else slideOut(direction)
        } else if (result.event === 'generate') {
            // The pulled body springs back to the centre while the new reply starts.
            dragX = 0
            startSpring(wasDragged)
            alternatives?.requestNewReply()
        } else {
            dragX = 0
            startSpring(wasDragged)
        }
    }
    // The body travels the stage's width, so a narrow bubble leaves the stage too; the peek, offset by the same width, lands at the centre.
    function slideOut(direction: 'back' | 'forward'): void {
        const distance = (stage?.clientWidth || bodyRoot?.clientWidth || 320) + PEEK_GAP_PX
        settling = { direction, index: position.index }
        settle = true
        dragX = direction === 'forward' ? -distance : distance
        clearTimeout(settleTimer)
        settleTimer = setTimeout(() => { void landStep() }, springDurationMs())
    }
    async function landStep(): Promise<void> {
        const pending = settling
        settleTimer = undefined
        if (!pending || destroyed) { settling = null; return }
        const id = pending.direction === 'back' ? 'stepPrev' : 'stepNext'
        try {
            // The busy state is asked again at landing: a reply may have started while the body was out.
            if (getBusy?.() === true || (unavailable as readonly SheetAction[]).includes(id) || position.index !== pending.index || (idx >= 0 && liveIndex() < 0)) {
                // Refused, moved some other way, or gone from the chat while the body was out: it springs back and nothing steps.
                settle = false
                dragX = 0
                startSpring(true)
                return
            }
            await stepNow(pending.direction)
        } finally {
            settling = null
            // A row that did not remount (the first message) shows its new content in place, with no travel back.
            if (!destroyed && !spring) {
                settle = false
                dragX = 0
                peek = null
            }
        }
    }
    // The spring exists only for a body that was displaced and only where motion is allowed; a timer owns its end so a missing transitionend never leaves a transform behind.
    function startSpring(wasDragged: boolean): void {
        clearTimeout(springTimer)
        if (!wasDragged || reducedMotionActive()) { spring = false; return }
        spring = true
        springTimer = setTimeout(() => { spring = false; peek = null }, springDurationMs() + SPRING_MARGIN_MS)
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

<!-- The article keeps the transcript semantics and is a tab stop and the focus target of message navigation, so its key and context-menu events and the captured clicks and submits of rich message content must reach it; the swipe gesture listens here too, so it starts on the message's own parts (SWIPE_START_PARTS) except on an interactive descendant, and the body moves. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
<article class="risu-chat" class:user={message.role === 'user'} data-part="chat-message" data-role={message.role} data-run={firstMessage ? 'single' : run} data-meta={namesHidden ? 'hidden' : 'shown'} data-streaming={streaming ? '' : undefined} data-hidden={disabled ? '' : undefined} data-bookmarked={isBookmarked ? '' : undefined} data-chat-index={idx} data-chat-id={chatId ?? ''} aria-labelledby={labelId} tabindex="0" bind:this={article} style:touch-action="pan-y" onpointerdown={onPointerDown} onpointermove={onPointerMove} onpointerup={onPointerUp} onpointercancel={() => { if (swipe) finishSwipe(swipe.cancel()) }} onclickcapture={(event) => handleButtonTriggerWithin(event, liveIndex)} onsubmitcapture={(event) => handleFormTriggerWithin(event, liveIndex)} onkeydown={onMessageKey} oncontextmenu={(event) => { if (!window.getSelection()?.toString() || event.shiftKey) { event.preventDefault(); openActions(event.currentTarget, { x: event.clientX, y: event.clientY }) } }}>
    {#if disabled === true}<div data-part="chat-message-divider" data-kind="disabled"></div>{/if}
    <div data-part="chat-message-name-row">
        <div data-part="chat-message-meta">
            {#if !$HideIconStore && iconMounted && !namesHidden}
                {#if avatar}<img data-part="chat-message-avatar" data-round={DBState.db.roundIcons ? '' : undefined} src={avatar} alt="" onerror={() => { avatar = null }} />
                {:else}<span data-part="chat-message-avatar" data-round={DBState.db.roundIcons ? '' : undefined} aria-hidden="true">{name.slice(0, 1)}</span>{/if}
            {/if}
            <span data-part="chat-message-name" id={labelId} data-name-hidden={namesHidden ? '' : undefined}>{name}</span>
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
    <!-- The stage holds the body and its swipe feedback; the peek, the meter and the ring are cues only and never take input. -->
    <div data-part="chat-message-stage" bind:this={stage} data-settle={settle ? '' : undefined} data-spring={spring ? '' : undefined}>
        {#if peek && (swipeLocked || settle || spring)}
            <div data-part="chat-swipe-peek" aria-hidden="true" data-from={peek.from} style:transform={`translateX(calc(${dragX}px ${peek.from === 'right' ? '+' : '-'} (100% + ${PEEK_GAP_PX}px)))`}>
                <span data-part="chat-swipe-peek-chip">{peek.index} / {position.count}</span>
                {#if peek.text}<span data-part="chat-swipe-peek-text">{peek.text}</span>{/if}
            </div>
        {/if}
        <div data-part="chat-message-body" class="text chat-width chattext prose minw-0" class:prose-invert={$ColorSchemeTypeStore} style:font-size={`${0.875 * ((DBState.db.zoomsize ?? 100) / 100)}rem`} style:line-height={`${(DBState.db.lineHeight ?? 1.25) * ((DBState.db.zoomsize ?? 100) / 100)}rem`} bind:this={bodyRoot} style:transform={dragX !== 0 || spring ? `translateX(${dragX}px)` : undefined} style:touch-action="pan-y" data-spring={spring ? '' : undefined} data-settle={settle ? '' : undefined} data-commit={commitDirection ?? undefined} onanimationend={() => { commitDirection = null }} ontransitionend={() => { spring = false }} onwheel={onWheel} onclick={() => { if (DBState.db.clickToEdit && idx >= 0 && !streaming) editor.startOriginalEdit() }}>
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
        {#if commitMark}<span data-part="chat-swipe-commit-mark" aria-hidden="true" onanimationend={() => { commitMark = false }}></span>{/if}
        {#if swipeProgress > 0 && !(swipeLocked && streaming)}
            {@const fill = meterFill(swipeProgress, armed, gestureStepped)}
            <!-- The arc follows the pull directly (no transition on it); only the icon turns, and not where motion is reduced or power is low. -->
            <div data-part="chat-swipe-meter" aria-hidden="true" data-armed={armed ? '' : undefined} data-fill={fill.toFixed(2)}>
                <svg viewBox="0 0 40 40" width="40" height="40" focusable="false"><circle class="meter-track" cx="20" cy="20" r="15" /><circle class="meter-arc" cx="20" cy="20" r="15" style:stroke-dashoffset={String(METER_RING * (1 - fill))} /></svg>
                <span class="meter-icon" style:transform={gestureStepped ? undefined : `rotate(${Math.round(fill * 360)}deg)`}><RefreshCwIcon size={18} aria-hidden="true" /></span>
            </div>
        {/if}
        {#if longPressRing}<span data-part="chat-long-press-ring" aria-hidden="true" style:left={ringAt ? `${ringAt.x}px` : undefined} style:top={ringAt ? `${ringAt.y}px` : undefined}></span>{/if}
    </div>
    {#if swipeLocked && streaming}<span data-part="chat-swipe-arm" role="status">{language.chatShellStillWriting}</span>
    {:else if swipeLocked && dragX > 0 && position.index <= 1 && !firstMessage}<span data-part="chat-swipe-arm" role="status">{language.chatShellFirstReply}</span>
    {:else if swipeProgress > 0}<span data-part="chat-swipe-arm" role="status" style:opacity={swipeProgress}>{armed ? language.chatShellReleaseNewReply : language.chatShellNoSavedReplies}</span>{/if}
    {#if userLast && !streaming}<button type="button" data-part="chat-generate-reply" disabled={getBusy?.() === true} onclick={generateAfterUser}>⟳ {language.chatShellGenerateReply}</button>{/if}
    {#if showPager || continuation > 0}
        <AlternativesRow bind:this={alternatives} {source} {idx} {expectedId} index={position.index} count={position.count} {firstMessage} pager={showPager} browseOnly={!newestCharacter && !firstMessage} {continuation} busy={getBusy?.() ?? false} onwheel={onWheel} onStep={(direction) => { void browse(direction) }} onEnd={() => { void bringBackContinuation() }} />
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
    [data-part="chat-message-name"][data-name-hidden] { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
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
        :global(html:not(.rm-off)) [data-part="chat-message-body"][data-spring] { transition: none; }
        :global(html:not(.rm-off)) [data-part="chat-message-body"][data-commit] { animation: commit-fade var(--chat-dur-fast) var(--chat-ease-out) both; }
    }
    :global(html.rm) [data-part="chat-message-body"][data-spring] { transition: none; }
    :global(html.rm) [data-part="chat-message-body"][data-commit] { animation: commit-fade var(--chat-dur-fast) var(--chat-ease-out) both; }
    :global(html[data-low-power]) [data-part="chat-message-body"][data-spring] { transition-duration: var(--dur-lowpower-cap); }
    :global(html[data-low-power]) [data-part="chat-message-body"][data-commit] { animation-duration: var(--dur-lowpower-cap); }
    /* Swipe feedback (SLICE1_SPEC §2, §3.2, §5.2): only transform and opacity animate. */
    [data-part="chat-message-stage"] { position: relative; overflow-x: clip; }
    [data-part="chat-message-body"][data-settle] { transition: transform var(--chat-dur-slow) var(--chat-ease-out); }
    [data-part="chat-swipe-peek"] { position: absolute; inset: 0 0 auto 0; max-height: 100%; overflow: hidden; display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-3) var(--space-8); opacity: var(--opacity-soft); pointer-events: none; color: var(--nexus-text); }
    [data-part="chat-message-stage"][data-settle] [data-part="chat-swipe-peek"] { opacity: 1; transition: transform var(--chat-dur-slow) var(--chat-ease-out), opacity var(--chat-dur-slow) var(--chat-ease-out); }
    [data-part="chat-message-stage"][data-spring] [data-part="chat-swipe-peek"] { transition: transform var(--chat-dur-slow) var(--chat-ease-spring); }
    :global(html[data-low-power]) [data-part="chat-message-stage"][data-spring] [data-part="chat-swipe-peek"], :global(html.nexus-low-power) [data-part="chat-message-stage"][data-spring] [data-part="chat-swipe-peek"] { transition-duration: var(--dur-lowpower-cap); }
    [data-part="chat-swipe-peek-chip"] { align-self: flex-start; padding: 0 var(--space-6); border-radius: var(--radius-pill); background: var(--nexus-surface-flat); color: var(--nexus-text-secondary); font-size: var(--font-size-xs); }
    [data-part="chat-swipe-peek"][data-from="left"] [data-part="chat-swipe-peek-chip"] { align-self: flex-end; }
    [data-part="chat-swipe-peek-text"] { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
    [data-part="chat-swipe-meter"] { position: absolute; right: var(--offset-5); top: 50%; width: var(--size-19); height: var(--size-19); margin-top: calc(var(--size-19) / -2); display: grid; place-items: center; border-radius: var(--radius-circle); background: var(--nexus-surface-flat); color: var(--nexus-text-secondary); pointer-events: none; }
    [data-part="chat-swipe-meter"][data-armed] { color: var(--nexus-accent); }
    [data-part="chat-swipe-meter"] svg { position: absolute; inset: 0; transform: rotate(var(--angle-start)); fill: none; stroke-width: var(--stroke-heavy); }
    .meter-track { stroke: var(--nexus-edge-strong); }
    .meter-arc { stroke: currentColor; stroke-linecap: round; stroke-dasharray: var(--meter-circumference); }
    .meter-icon { display: grid; place-items: center; }
    [data-part="chat-long-press-ring"] { position: absolute; width: var(--size-27); height: var(--size-27); margin: calc(var(--size-27) / -2) 0 0 calc(var(--size-27) / -2); border: var(--stroke-heavy) solid var(--nexus-accent); border-radius: var(--radius-circle); pointer-events: none; animation: lp-fill var(--dur-ring) var(--ease-linear) both; }
    @media (prefers-reduced-motion: reduce) { :global(html:not(.rm-off)) [data-part="chat-long-press-ring"] { animation-name: lp-fade; } }
    :global(html.rm) [data-part="chat-long-press-ring"] { animation-name: lp-fade; }
    :global(html[data-low-power]) [data-part="chat-long-press-ring"], :global(html.nexus-low-power) [data-part="chat-long-press-ring"] { animation: none; }
    @keyframes lp-fill { from { transform: scale(var(--scale-ring-start)); opacity: var(--opacity-faint); } to { transform: scale(1); opacity: 1; } }
    @keyframes lp-fade { from { opacity: var(--opacity-faint); } to { opacity: 1; } }
    [data-part="chat-swipe-commit-mark"] { position: absolute; inset: 0; border: var(--stroke-bold) solid var(--nexus-accent); border-radius: var(--radius-4); pointer-events: none; opacity: 0; animation: commit-mark var(--dur-highlight) var(--ease-linear) both; }
    :global(html[data-low-power]) [data-part="chat-swipe-commit-mark"], :global(html.nexus-low-power) [data-part="chat-swipe-commit-mark"] { animation-timing-function: steps(1, end); }
    @keyframes commit-mark { 0%, 50% { opacity: 1; } 100% { opacity: 0; } }
    [data-part="chat-message-interrupted"] { color: var(--nexus-text-secondary); font-style: italic; font-size: var(--font-size-xs); }
    [data-part="chat-status-row"] { color: var(--nexus-text-secondary); font-size: var(--font-size-xs); }
    [data-part="chat-message-delete-pending"] { color: var(--nexus-text-secondary); font-style: italic; font-size: var(--font-size-xs); }
    [data-part="chat-message-render-failed"] { color: var(--nexus-text-secondary); font-style: italic; font-size: var(--font-size-xs); }
    [data-part="chat-message-divider"] { border-top: var(--stroke-bold) dashed var(--color-warning); }
    [data-part="chat-message-divider"][data-kind="disabled"] { border-top-color: var(--color-accent); }
    [data-part="chat-message-memory-limit"] { border-top-style: solid; border-top-color: var(--color-accent); }
    button { color: var(--nexus-text-secondary); }
</style>
