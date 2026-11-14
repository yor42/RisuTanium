<script lang="ts">
    import { onMount, tick, untrack } from 'svelte'
    import { afterFlush } from '../../ts/afterFlush'
    import '../../styles/chat-tokens.css'
    import { get } from 'svelte/store'
    import { DBState, alertStore, selIdState, sideBarStore } from '../../ts/stores.svelte'
    import { language } from '../../lang'
    import { postToast } from '../../ts/toast/toastHost.svelte'
    import type SendFailureCardComponent from './SendFailureCard.svelte'
    import type NotificationsOffNoticeComponent from '../ChatScreens/NotificationsOffNotice.svelte'
    import { chatWindowKey } from '../../ts/chatWindowPolicy'
    import type ShellHeaderComponent from './ShellHeader.svelte'
    import type ShellComposerComponent from './ShellComposer.svelte'
    import type PersonaSheetComponent from './PersonaSheet.svelte'
    import type ThisChatSheetComponent from './ThisChatSheet.svelte'
    import type ChatDeleteConfirmComponent from './ChatDeleteConfirm.svelte'
    import type TogglesPanelComponent from './TogglesPanel.svelte'
    import type { PatternAnswer } from '../Nexus/pattern/patternWarning'
    import type { FavouriteRef } from '../../ts/chatShell/toggleFavourites'
    import type { Chat, character as Character, groupChat } from '../../ts/storage/database.svelte'
    import type PlusSheetComponent from './PlusSheet.svelte'
    import type ShellNoticesComponent from './ShellNotices.svelte'
    import type ShellFloatingButtonsComponent from './ShellFloatingButtons.svelte'
    import type JumpSheetComponent from './JumpSheet.svelte'
    import type FindBarComponent from './FindBar.svelte'
    import type FindFiltersSheetComponent from './FindFiltersSheet.svelte'
    import type FindResultsSheetComponent from './FindResultsSheet.svelte'
    import type ReturnChipComponent from './ReturnChip.svelte'
    import type ShellMessageListComponent from './ShellMessageList.svelte'
    import type SwitchFrameComponent from './SwitchFrame.svelte'
    import type { SwitchTargetState } from '../../ts/chatShell/switchTarget.svelte'
    import type ActionSheetComponent from './ActionSheet.svelte'
    import type CustomizeButtonsSheetComponent from './CustomizeButtonsSheet.svelte'
    import type { ActionRequest, CustomizeRequest } from './ShellMessage.svelte'
    import { shouldAnchorBottom } from '../../ts/chatShell/bottomAnchor'
    import { bindReaderIntent, canHostMove, createReaderIntent } from '../../ts/chatShell/readerIntent'
    import { watchSoftKeyboard } from '../../ts/chatShell/softKeyboard'
    import { isLongJump, latestButtonVisible, type JumpResult, type JumpStatus } from '../../ts/chatShell/jumpTarget'
    import { createReturnChip, type ReturnChipState } from '../../ts/chatShell/returnChip'
    import { installFindKey, installJumpSheetKey, installTranscriptEndKey } from '../../ts/chatShell/shellJumpKeys'
    import { DEFAULT_FILTERS, createFindSession, sameFingerprint, searchFingerprint, type FindSession, type FindSessionState, type SearchFingerprint } from '../../ts/chatShell/findSession'
    import { createFindRun, type FindRun } from '../../ts/chatShell/findRun'
    import { createSearchCache, dayBoundsOf, matchesQuery, passesFilters, type DayBounds, type SearchFilters, type SearchHit } from '../../ts/chatShell/inChatSearch'
    import { firstMessageOf } from '../../ts/process/firstMessage'
    import { backCloseHandler, registerBackHandler } from '../../ts/backHandlers'
    import { hasOpenShell } from '../Nexus/pattern/patternFocus'
    import { lowPowerMarked } from '../../ts/chatShell/lowPower'
    import { reducedMotionActive } from '../../ts/chatShell/motionPrefs.svelte'
    import { hostIme } from '../../ts/android/hostBridge'
    import { treeView } from '../../ts/process/chatTreeView'
    import { inputOf, layoutOf } from '../../ts/gui/rootAttributes'
    import { declareSurface } from '../../ts/themePack/surfaceGate.svelte'

    interface Props {
        openChatList?: boolean
        openModuleList?: boolean
        customStyle?: string
    }
    let { openChatList = $bindable(false), openModuleList = $bindable(false), customStyle = '' }: Props = $props()

    let ShellHeader: typeof ShellHeaderComponent | null = $state(null)
    let ShellComposer: typeof ShellComposerComponent | null = $state(null)
    let PersonaSheet: typeof PersonaSheetComponent | null = $state(null)
    let PlusSheet: typeof PlusSheetComponent | null = $state(null)
    // The This-chat sheet and its delete confirm load after the shell is up and never hold the composer back.
    let ThisChatSheet: typeof ThisChatSheetComponent | null = $state(null)
    let ChatDeleteConfirm: typeof ChatDeleteConfirmComponent | null = $state(null)
    // The toggles panel loads the same way; its module also reads the counts for the summary rows.
    let TogglesPanel: typeof TogglesPanelComponent | null = $state(null)
    let togglesModule: typeof import('./TogglesPanel.svelte') | null = $state.raw(null)
    let ShellNotices: typeof ShellNoticesComponent | null = $state(null)
    let ShellFloatingButtons: typeof ShellFloatingButtonsComponent | null = $state(null)
    // The jump sheet and the return chip load with the This-chat sheet and never hold the composer back.
    let JumpSheet: typeof JumpSheetComponent | null = $state(null)
    let ReturnChip: typeof ReturnChipComponent | null = $state(null)
    // The search bar loads with them: search is opened by the reader, never at first paint.
    let FindBar: typeof FindBarComponent | null = $state(null)
    let FindFiltersSheet: typeof FindFiltersSheetComponent | null = $state(null)
    let FindResultsSheet: typeof FindResultsSheetComponent | null = $state(null)
    let ShellMessageList: typeof ShellMessageListComponent | null = $state(null)
    // The switch frame and the pending-switch state load after the shell is up; neither holds the first paint back.
    let SwitchFrame: typeof SwitchFrameComponent | null = $state(null)
    let switchState: SwitchTargetState | null = $state.raw(null)
    let ActionSheet: typeof ActionSheetComponent | null = $state(null)
    let CustomizeButtonsSheet: typeof CustomizeButtonsSheetComponent | null = $state(null)
    let composerActions: typeof import('../../ts/process/composerActions.svelte') | null = null
    // The failed-send card and its records load after the shell is up and never hold the composer back: the gate itself lives in the composer's source.
    let SendFailureCard: typeof SendFailureCardComponent | null = $state(null)
    let sendFailures: typeof import('../../ts/chatShell/sendFailure.svelte') | null = $state.raw(null)
    let settingsRoute: typeof import('../Setting/settingsRoute') | null = null
    // The notification-permission notice loads on its own so the character-only early return below never skips it.
    let NotificationsOffNotice: typeof NotificationsOffNoticeComponent | null = $state(null)
    let messageList: ReturnType<typeof ShellMessageListComponent> | undefined = $state()
    // One action sheet and one customize sheet serve every row; they live outside the transcript so a row's clipping cannot cover them.
    let actionRequest: ActionRequest | null = $state.raw(null)
    let actionOpen = $state(false)
    let customizeRequest: CustomizeRequest | null = $state.raw(null)
    let customizeOpen = $state(false)
    let unread = $state(false)
    let atBottom = $state(true)
    let newCount = $state(0)
    let farFromLatest = $state(false)
    let surface = $state<{ hidden: boolean; closeEpoch: number } | null>(null)
    let surfaceHidden = $state(false)
    let busy = $state(false)

    let character = $derived(DBState.db.characters[selIdState.selId])
    // While a switch is pending or failed the header names the character being switched to; the chat shown stays unchanged underneath.
    let switchPending = $derived(!!switchState && switchState.phase !== 'idle')
    let headerName = $derived(switchPending ? switchState?.target?.name ?? '' : character?.name ?? '')
    let shownChat = $derived(character?.chats?.[character.chatPage])
    let shownChatName = $derived(shownChat?.name ?? '')
    let headerChatName = $derived(switchPending ? '' : shownChatName)
    // The title and the announcement follow the chat shown; the base title returns when the shell goes away.
    const baseTitle = typeof document !== 'undefined' ? document.title : ''
    let announcement = $state('')
    let fade = $state<'a' | 'b' | undefined>(undefined)
    // Plain variables on purpose: the effect below must depend on the shown chat only.
    let announcedFrom: { chat: Chat | undefined } | null = null
    let fadeFlip = false
    let headerHidden = $state(false)
    let hardwareKeyboardSeen = $state(false)
    // The header hides while the soft keyboard is open; the scroll rule (headerHidden) keeps its own state underneath, so
    // closing the keyboard returns to what the scroll rule wants.
    let keyboardOpen = $state(false)
    let personaOpen = $state(false)
    let personaOpener = $state<HTMLElement | null>(null)
    // The picker opened from the This-chat sheet stacks above it, so everything beside its own layer is inert.
    let personaOverSheet = $state(false)
    let thisChatOpen = $state(false)
    // The owner and chat the sheet was opened for; the sheet closes as soon as the shown chat is another one.
    let thisChatTarget = $state.raw<{ owner: Character | groupChat, chat: Chat } | null>(null)
    let sheetLayer = $state<HTMLElement>()
    // The delete confirm of the sheet: ChatShell owns it and mounts it after the sheet layer, never inside the sheet.
    type DeleteRequest = { chat: Chat, busy: boolean, trigger: HTMLElement | null, resolve: (confirmed: boolean) => void }
    let deleteRequest = $state.raw<DeleteRequest | null>(null)
    // The toggles panel works on the owner and chat it was opened for, like the sheet, and closes when the shown chat changes.
    let togglesOpen = $state(false)
    let togglesOpener = $state<HTMLElement | null>(null)
    let togglesTarget = $state.raw<{ owner: Character | groupChat, chat: Chat } | null>(null)
    // The star whose row the panel opens at; null for every opening that is not a text chip.
    let togglesAt = $state.raw<FavouriteRef | null>(null)
    // Opened from the This-chat sheet it stacks above it; closing the sheet takes it along.
    let togglesOverSheet = false
    let plusOpen = $state(false)
    let stickersOpen = $state(false)
    let opener = $state<HTMLElement | null>(null)
    let shell = $state<HTMLElement>()
    let header = $state<HTMLElement>()
    let list = $state<HTMLElement>()
    let composer = $state<HTMLElement>()
    // The one source of reader intent for the transcript: the header rule and the follower both read it, never scrollTop.
    const readerIntent = createReaderIntent({ canMove: (direction) => !!list && canHostMove(list, direction) })
    let olderDistance = 0
    let previousBusy = false
    let seenCloseEpoch = 0
    let layout = $state<'phone' | 'mid' | 'wide'>('phone')
    let inputMode = $state<'touch' | 'hover'>('touch')
    // The wide layout never hides the header; a hardware keyboard keeps it shown (ShellHeader applies that rule to the attribute).
    let headerHiddenNow = $derived((headerHidden || keyboardOpen) && layout !== 'wide')
    // Reported by the header itself, so the scroll padding agrees with what the reader sees (hardware keyboard, focus, wide layout).
    // The header floats over the transcript, so showing or hiding it never changes the transcript's geometry.
    let headerConcealed = $state(false)

    // A mounted shell is the one surface a theme pack's chat sheet may style; the release is the teardown.
    $effect(() => declareSurface('chat'))

    onMount(() => {
        if (!shell) return
        return watchSoftKeyboard(shell, window, (open) => { keyboardOpen = open }, hostIme())
    })

    $effect(() => {
        const name = shownChatName
        document.title = name ? (baseTitle ? `${name} · ${baseTitle}` : name) : baseTitle
        return () => { document.title = baseTitle }
    })

    // A shown-chat change after mount is announced and fades the transcript in; the first run only records the chat.
    $effect(() => {
        const chat = shownChat
        const previous = announcedFrom
        announcedFrom = { chat }
        if (!previous || previous.chat === chat || !chat) return
        announcement = language.chatShellChatOpened(chat.name ?? '')
        fadeFlip = !fadeFlip
        fade = fadeAllowed() ? (fadeFlip ? 'a' : 'b') : undefined
    })

    // The fade is an animation: reduced motion (the app's setting, or the OS while it follows the system) and low power switch it off, so the attribute that starts it is never set.
    function fadeAllowed(): boolean {
        const root = document.documentElement
        return !lowPowerMarked(root) && !reducedMotionActive(root)
    }

    $effect(() => {
        if (!surface) return
        surfaceHidden = surface.hidden
        const epoch = surface.closeEpoch
        if (epoch !== seenCloseEpoch) {
            seenCloseEpoch = epoch
            plusOpen = false
            closeThisChat()
            closeJump()
            void closeFind('surface')
            closeToggles()
            stickersOpen = false
            actionOpen = false
            customizeOpen = false
        }
    })

    onMount(() => {
        let live = true
        void import('../ChatScreens/NotificationsOffNotice.svelte').then((noticeModule) => {
            if (!live) return
            NotificationsOffNotice = noticeModule.default
        }).catch((error) => console.error('The notifications-off notice did not load:', error))
        return () => { live = false }
    })

    onMount(() => {
        const updateRootState = () => {
            layout = layoutOf(window.innerWidth)
            inputMode = inputOf(window)
        }
        updateRootState()
        window.addEventListener('resize', updateRootState)
        const viewport = window.visualViewport
        let previousHeight = viewport?.height ?? 0
        const anchor = () => {
            const nextHeight = viewport?.height ?? 0
            if (shouldAnchorBottom({ wasAtBottom: atBottom, surfaceHidden, previousHeight, nextHeight })) {
                requestAnimationFrame(() => messageList?.anchorNewestBottom?.())
            }
            previousHeight = nextHeight
        }
        viewport?.addEventListener('resize', anchor)
        if (character?.type !== 'character') return () => { window.removeEventListener('resize', updateRootState); viewport?.removeEventListener('resize', anchor) }
        let live = true
        let unsubscribe = () => {}
        void Promise.all([import('./SendFailureCard.svelte'), import('../../ts/chatShell/sendFailure.svelte'), import('../Setting/settingsRoute')]).then(([cardModule, failureModule, routeModule]) => {
            if (!live) return
            settingsRoute = routeModule
            sendFailures = failureModule
            SendFailureCard = cardModule.default
        }).catch((error) => console.error('The failed-send card did not load:', error))
        void Promise.all([import('./ThisChatSheet.svelte'), import('./ChatDeleteConfirm.svelte')]).then(([sheetModule, confirmModule]) => {
            if (!live) return
            ThisChatSheet = sheetModule.default
            ChatDeleteConfirm = confirmModule.default
        }).catch((error) => console.error('The This-chat sheet did not load:', error))
        void Promise.all([import('./JumpSheet.svelte'), import('./ReturnChip.svelte'), import('./FindBar.svelte'), import('./FindFiltersSheet.svelte'), import('./FindResultsSheet.svelte')]).then(([jumpModule, chipModule, findModule, filtersModule, resultsModule]) => {
            if (!live) return
            JumpSheet = jumpModule.default
            ReturnChip = chipModule.default
            FindBar = findModule.default
            FindFiltersSheet = filtersModule.default
            FindResultsSheet = resultsModule.default
        }).catch((error) => console.error('The jump sheet did not load:', error))
        void Promise.all([import('./SwitchFrame.svelte'), import('../../ts/chatShell/switchTarget.svelte')]).then(([frameModule, targetModule]) => {
            if (!live) return
            switchState = targetModule.switchTarget
            SwitchFrame = frameModule.default
        }).catch((error) => console.error('The switch frame did not load:', error))
        void import('./TogglesPanel.svelte').then((panelModule) => {
            if (!live) return
            togglesModule = panelModule
            TogglesPanel = panelModule.default
        }).catch((error) => console.error('The toggles panel did not load:', error))
        void Promise.all([
            import('./ShellHeader.svelte'),
            import('./ShellComposer.svelte'),
            import('./PersonaSheet.svelte'),
            import('./PlusSheet.svelte'),
            import('./ShellNotices.svelte'),
            import('./ShellFloatingButtons.svelte'),
            import('../ChatScreens/chatSurface.svelte'),
            import('../../ts/process/index.svelte'),
            import('./ShellMessageList.svelte'),
            import('./ActionSheet.svelte'),
            import('./CustomizeButtonsSheet.svelte'),
            import('../../ts/process/composerActions.svelte'),
        ]).then(([headerModule, composerModule, personaModule, plusModule, noticesModule, floatingModule, surfaceModule, processModule, listModule, actionModule, customizeModule, actionsModule]) => {
            if (!live) return
            ActionSheet = actionModule.default
            CustomizeButtonsSheet = customizeModule.default
            composerActions = actionsModule
            ShellHeader = headerModule.default
            ShellComposer = composerModule.default
            PersonaSheet = personaModule.default
            PlusSheet = plusModule.default
            ShellNotices = noticesModule.default
            ShellFloatingButtons = floatingModule.default
            ShellMessageList = listModule.default
            surface = surfaceModule.chatSurface
            unsubscribe = processModule.doingChat.subscribe((value) => {
                busy = value
                if (previousBusy && !value) headerHidden = false
                previousBusy = value
            })
        })
        return () => { live = false; unsubscribe(); window.removeEventListener('resize', updateRootState); viewport?.removeEventListener('resize', anchor) }
    })

    function scroll(): void {
        messageList?.onScroll?.()
    }

    // Only the reader's input drives the header (C-3): 24 px of travel toward older hides it, any travel toward newer shows it.
    // Scroll keys do not drive it, and scroll events never do, so the browser's own scrollTop moves leave it alone.
    onMount(() => {
        const stop = readerIntent.subscribe((event) => {
            if (event.source === 'key') return
            if (event.direction === 'older') {
                olderDistance += event.distance
                if (olderDistance >= 24 && !hardwareKeyboardSeen) headerHidden = true
            } else {
                olderDistance = 0
                headerHidden = false
            }
        })
        return stop
    })
    $effect(() => {
        if (!list) return
        return bindReaderIntent(list, readerIntent)
    })

    // The End key is taken at the shell root before the transcript's reader-intent listener, so it does not cancel its own travel
    // and the header rule never sees it (the travel is programmatic, so the header stays as it is).
    onMount(() => {
        if (!shell) return
        return installTranscriptEndKey(shell, { transcript: () => list, run: () => void messageList?.jumpToLatest?.({ animate: fadeAllowed(), focusNewest: true }) })
    })
    // Focus moves to the newest message only when the button holds focus at the tap; a tap that did not focus the button leaves focus where it is.
    function jumpFromButton(): void {
        const active = document.activeElement
        void messageList?.jumpToLatest?.({ animate: fadeAllowed(), focusNewest: active instanceof Element && active.matches('[data-part="chat-new-message"]') })
    }

    // The return point of the last long jump. It belongs to one chat and leaves with the first of: the timer, the reader's own scrolling
    // (reader-intent events only, never a jump's own scroll), a tap, a chat switch, or the chat shrinking below the origin.
    let chipState = $state.raw<ReturnChipState>({ origin: null, chatKey: null })
    const chip = createReturnChip({
        setTimer: (callback, ms) => window.setTimeout(callback, ms),
        clearTimer: (id) => window.clearTimeout(id),
        onChange: () => { chipState = chip.state },
    })
    let jumpHost = $state<HTMLElement>()
    let jumpOpen = $state(false)
    let jumpOpener = $state<HTMLElement | null>(null)
    // The chat the sheet was opened for; the sheet closes as soon as the shown chat is another one.
    let jumpChat = $state.raw<Chat | null>(null)

    function chatKeyNow(): string {
        return `${character?.chaId ?? ''}:${shownChat?.id ?? ''}`
    }

    onMount(() => {
        const stop = readerIntent.subscribe((event) => chip.readerMoved(event.distance))
        return () => { stop(); chip.hide() }
    })

    $effect(() => {
        const state = chipState
        if (!state.origin) return
        const length = shownChat?.message.length ?? 0
        if (chatKeyNow() !== state.chatKey || length - 1 < state.origin.index) chip.hide()
    })

    function openJump(active: Element | null): void {
        if (surfaceHidden) return
        const chat = character?.chats?.[character.chatPage]
        if (!character || !chat) return
        jumpOpener = active instanceof HTMLElement && shell?.contains(active) ? active : list ?? null
        jumpChat = chat
        jumpOpen = true
    }

    function closeJump(): void {
        jumpOpen = false
    }

    $effect(() => {
        if (!jumpOpen) return
        if (!jumpChat || shownChat !== jumpChat) closeJump()
    })

    // A refusal the reader should see; a deferred or superseded jump is silent.
    function reportJump(result: JumpResult): void {
        if (result.status === 'blocked') postToast({ kind: 'warning', text: language.chatShellJumpEditorOpen })
        else if (result.status === 'outOfRange') postToast({ kind: 'warning', text: language.hypaV3Modal.connectedMessageNotFoundLabel })
    }

    // The sheet is gone (focus and inert restored) before the jump runs, so the focused target is never under an inert layer.
    async function runJump(index: number): Promise<void> {
        closeJump()
        await tick()
        const key = chatKeyNow()
        const result = await messageList?.jumpTo?.(index)
        if (!result) return
        reportJump(result)
        if (result.status !== 'done' || !result.from || !isLongJump(result.from.index, result.to) || key !== chatKeyNow()) return
        chip.show(result.from, key)
        announcement = ''
        await tick()
        announcement = language.chatShellJumpedBack
    }

    async function returnFromChip(): Promise<void> {
        const origin = chip.take()
        if (!origin) return
        const result = await messageList?.returnTo?.(origin)
        if (result) reportJump(result)
    }

    // ---- in-chat search
    // Everything one opening owns lives in `findCtx`, a plain variable: the open flag below is the only reactive copy, so no handler or effect
    // that closes search picks up a dependency by asking whether it is open.
    interface FindContext {
        session: FindSession
        run: FindRun
        chat: Chat
        // Where focus was when search opened; it returns there at a close the reader asked for.
        opener: HTMLElement | null
    }
    let findCtx: FindContext | null = null
    let findOpen = $state(false)
    let findChat = $state.raw<Chat | null>(null)
    let findState = $state.raw<FindSessionState | null>(null)
    let searchHit = $state.raw<SearchHit | null>(null)
    let findBar: ReturnType<typeof FindBarComponent> | undefined = $state()
    let findFingerprint: SearchFingerprint | null = null
    let noResultsFor: string | null = null
    // The filters and results sheets belong to one opening of the bar: closing the bar takes them along.
    let filtersOpen = $state(false)
    let filtersOpener = $state<HTMLElement | null>(null)
    let resultsOpen = $state(false)
    let resultsOpener = $state<HTMLElement | null>(null)
    let resultsImages = $state<{ user: string, char: string }>({ user: '', char: '' })

    function dayBoundsMemo(): (filters: SearchFilters) => DayBounds {
        let last: { filters: SearchFilters, bounds: DayBounds } | null = null
        return (filters) => {
            if (last?.filters !== filters) last = { filters, bounds: dayBoundsOf(filters.from, filters.to) }
            return last.bounds
        }
    }

    // The session reads the shown chat through these accessors at scan and show time, never ahead of it.
    function createFindContext(owner: Character | groupChat, chat: Chat): FindContext {
        const cache = createSearchCache()
        // The first message is not in the array; this object is its cache key and its text is its identity.
        const firstKey = {}
        const boundsOf = dayBoundsMemo()
        const firstText = (): string => firstMessageOf(owner, chat)
        // A chat that shrank under a scan slice reads as no message: the fingerprint effect restarts the scan right after.
        const textAt = (index: number, thinking: boolean): string => {
            if (index < 0) return cache.textFor(firstKey, firstText(), thinking)
            const message = chat.message[index]
            return message ? cache.textFor(message, message.data, thinking) : ''
        }
        const passes = (index: number, filters: SearchFilters): boolean => {
            const message = index < 0 ? { role: 'char' as const, data: firstText(), time: undefined } : chat.message[index]
            return message !== undefined && passesFilters(message, filters, boundsOf(filters))
        }
        const run = createFindRun({
            readOrigin: () => messageList?.readOrigin?.() ?? null,
            jumpTo: async (index) => (await messageList?.jumpTo?.(index, { recordOrigin: false, focus: false })) ?? { status: 'cancelled', from: null, to: index },
            chatKey: chatKeyNow,
        })
        const context: FindContext = {
            run,
            chat,
            opener: null,
            session: createFindSession({
                count: () => chat.message.length,
                includeFirst: true,
                messageAt: (index) => chat.message[index],
                firstText,
                textAt,
                passes,
                stillMatches: (hit, query, filters) => {
                    const thinking = filters.thinking
                    const index = hit.index
                    return matchesQuery(textAt(index, thinking), query) && passes(index, filters)
                },
                lowPower: () => lowPowerMarked(),
                onShow: (hit, index) => showHit(context, hit, index),
                onChange: () => { if (findCtx === context) findStateChanged(context) },
            }),
        }
        return context
    }

    function findStateChanged(context: FindContext): void {
        const state = context.session.state
        findState = state
        const key = state.query === '' ? null : `${state.query}\n${state.filters.speaker}${state.filters.hasImage}${state.filters.thinking}${state.filters.from}${state.filters.to}`
        if (key !== null && state.complete && state.hits.length === 0) {
            if (noResultsFor !== key) {
                noResultsFor = key
                void say(language.chatShellFindNoResults)
            }
        }
        else noResultsFor = null
    }

    // Clear then set, so the same text announces again.
    async function say(text: string): Promise<void> {
        announcement = ''
        await tick()
        announcement = text
    }

    // A hit jump never records an origin, shows no chip and takes no focus: the reader keeps typing, and the run keeps the pre-search place.
    async function showHit(context: FindContext, target: SearchHit, index: number): Promise<JumpStatus> {
        if (surfaceHidden) return 'deferred'
        if (!context.run.live) return 'cancelled'
        searchHit = target
        const result = await context.run.show(index)
        if (result === null) return 'cancelled'
        reportJump(result)
        // A query typed while the jump ran has cleared the hit; the old match is not announced.
        if (result.status === 'done' && searchHit === target && findCtx === context) {
            const state = context.session.state
            const position = ((state.current ?? 0) + 1).toLocaleString()
            const total = state.hits.length.toLocaleString()
            void say(state.complete ? language.chatShellFindMatchLabel(position, total) : language.chatShellFindMatchLabelPartial(position, total))
        }
        return result.status
    }

    function openFind(active: Element | null): void {
        if (surfaceHidden || !FindBar) return
        if (findCtx) {
            findBar?.focusField(true)
            return
        }
        const owner = character
        const chat = owner?.chats?.[owner.chatPage]
        if (!owner || owner.type !== 'character' || !chat) return
        const context = createFindContext(owner, chat)
        context.opener = active instanceof HTMLElement && shell?.contains(active) ? active : null
        findCtx = context
        findFingerprint = null
        noResultsFor = null
        findState = context.session.state
        findChat = chat
        searchHit = null
        const resting = untrack(() => atBottom)
        findOpen = true
        void settleAfterReserveChange(resting).then(() => findBar?.focusField())
    }

    // The bar swap changes the transcript's top reserve by one row once; a reader resting at the newest message stays there.
    async function settleAfterReserveChange(resting: boolean): Promise<void> {
        await tick()
        if (resting) messageList?.anchorNewestBottom?.()
    }

    // "Search in chat" from the jump sheet: the sheet is gone (focus restored) before the bar opens, so the bar's opener is the sheet's own.
    async function searchFromJump(): Promise<void> {
        const from = jumpOpener
        closeJump()
        await tick()
        openFind(from)
    }

    function openFindFilters(element: HTMLElement): void {
        if (!findCtx) return
        filtersOpener = element
        filtersOpen = true
    }

    function openFindResults(element: HTMLElement): void {
        const context = findCtx
        if (!context) return
        resultsOpener = element
        resultsOpen = true
        void loadResultImages(context)
    }

    // The sheet draws an initial until the avatars resolve; a sheet closed or a bar reopened meanwhile drops the late answer.
    async function loadResultImages(context: FindContext): Promise<void> {
        const owner = character
        if (!owner) return
        try {
            const { getCharImage } = await import('../../ts/characters')
            const [user, char] = await Promise.all([getCharImage(DBState.db.userIcon ?? '', 'plain'), getCharImage(owner.image ?? '', 'plain')])
            if (findCtx === context) resultsImages = { user: user ?? '', char: char ?? '' }
        } catch (error) {
            console.error('The search result avatars did not load:', error)
        }
    }

    // The sheet is gone (focus and inert restored) before the hit is shown, so nothing is shown under an inert layer.
    async function showFromResults(position: number): Promise<void> {
        const context = findCtx
        resultsOpen = false
        await tick()
        if (context && findCtx === context) await context.session.show(position)
    }

    function onFindFilters(patch: Partial<SearchFilters>): void {
        searchHit = null
        findCtx?.session.setFilters(patch)
    }

    let resultsFirstText = $derived(resultsOpen && character?.type === 'character' && shownChat ? firstMessageOf(character, shownChat) : '')

    function returnFindFocus(context: FindContext): void {
        const opener = context.opener
        const target = opener?.isConnected && shell?.contains(opener) ? opener : header?.querySelector<HTMLElement>('[data-part="chat-header-menu"]') ?? list
        target?.focus({ preventScroll: true })
    }

    // `user`: Esc, the close button, Back, mouse button 3 (focus returns, a long move offers the return chip). `surface` (Settings or Studio
    // opened) and `chat` (another chat is shown) take neither: the chip belongs to a place the reader has left, and focus stays where it is.
    // Closing never scrolls; a hit jump already requested settles first and the chip is judged from where the reader actually is.
    async function closeFind(cause: 'user' | 'surface' | 'chat'): Promise<void> {
        const context = findCtx
        if (!context) return
        findCtx = null
        findChat = null
        findState = null
        searchHit = null
        const resting = untrack(() => atBottom)
        findOpen = false
        filtersOpen = false
        resultsOpen = false
        context.session.dispose()
        const closing = context.run.close()
        void settleAfterReserveChange(resting)
        if (cause !== 'user') return
        const owed = await closing
        if (findCtx) return
        await tick()
        returnFindFocus(context)
        if (owed) {
            chip.show(owed.origin, owed.key)
            void say(language.chatShellJumpedBack)
        }
    }

    onMount(() => {
        if (!shell) return
        return installFindKey({
            shellRoot: shell,
            surfaceVisible: () => !surfaceHidden && character?.type === 'character' && !!shownChat,
            sidebarOpen: () => get(sideBarStore),
            alertType: () => get(alertStore).type,
            onopen: openFind,
            findBar: () => findBar?.element(),
            onrefocus: () => findBar?.focusField(true),
        })
    })

    // The shown chat is the one search was opened for.
    $effect(() => {
        if (!findOpen) return
        if (shownChat !== findChat) void closeFind('chat')
    })

    // A change under the scan restarts it silently: the array, its length, the last message once streaming ends, or the first message.
    // While a reply streams the last message's text is not read, so chunks neither restart the scan nor make it a dependency.
    $effect(() => {
        if (!findOpen) return
        const chat = shownChat
        const owner = character
        if (!chat || !owner || owner.type !== 'character') return
        const next = searchFingerprint({ messages: chat.message, streaming: chat.isStreaming === true, firstText: firstMessageOf(owner, chat) })
        const previous = findFingerprint
        findFingerprint = next
        if (previous && !sameFingerprint(previous, next)) untrack(() => findCtx?.session.restart())
    })

    // Back closes in one step with no history entry; the mouse's back button does the same.
    $effect(() => {
        if (!findOpen) return
        const unregister = registerBackHandler(backCloseHandler({
            isOpen: () => findOpen,
            snapshot: () => findOpen,
            close: () => { void closeFind('user') },
        }))
        const onMouseUp = (event: MouseEvent): void => {
            if (event.button !== 3 || hasOpenShell()) return
            event.preventDefault()
            void closeFind('user')
        }
        window.addEventListener('mouseup', onMouseUp)
        return () => { unregister(); window.removeEventListener('mouseup', onMouseUp) }
    })

    // A new query or new filters clear the displayed hit in the same flush, before the new scan can show another.
    function onFindQuery(value: string, options: { composing: boolean }): void {
        searchHit = null
        findCtx?.session.setQuery(value, options)
    }

    function onFindClearFilters(): void {
        searchHit = null
        findCtx?.session.clearFilters()
    }

    onMount(() => {
        if (!shell) return
        return installJumpSheetKey({
            shellRoot: shell,
            surfaceVisible: () => !surfaceHidden && character?.type === 'character' && !!shownChat,
            sidebarOpen: () => get(sideBarStore),
            alertType: () => get(alertStore).type,
            onopen: openJump,
        })
    })

    function openPersona(element: HTMLElement): void {
        if (surfaceHidden) return
        personaOverSheet = false
        personaOpener = element
        personaOpen = true
    }

    function openPersonaFromSheet(element: HTMLElement): void {
        if (surfaceHidden) return
        personaOverSheet = true
        personaOpener = element
        personaOpen = true
    }

    function openThisChat(element: HTMLElement): void {
        if (surfaceHidden) return
        const chat = character?.chats?.[character.chatPage]
        if (!character || !chat) return
        opener = element
        thisChatTarget = { owner: character, chat }
        thisChatOpen = true
    }

    // Closing the sheet takes the picker opened over it and a pending delete confirm (answered as cancelled) with it.
    function closeThisChat(): void {
        thisChatOpen = false
        if (personaOverSheet) personaOpen = false
        if (togglesOverSheet) closeToggles()
        void settleDelete(false)
    }

    // The sheet belongs to the chat it was opened for: when the shown chat is another one, it closes.
    $effect(() => {
        if (!thisChatOpen) return
        const target = thisChatTarget
        const shown = character?.chats?.[character.chatPage]
        if (!target || shown !== target.chat) closeThisChat()
    })

    function confirmDelete(request: { chat: Chat, busy: boolean }, trigger: HTMLElement | null): Promise<boolean> {
        void settleDelete(false)
        return new Promise((resolve) => { deleteRequest = { ...request, trigger, resolve } })
    }

    // The confirm's layer is gone (inert released, focus returned) before the removal that waits for it runs.
    async function settleDelete(confirmed: boolean): Promise<void> {
        const request = deleteRequest
        if (!request) return
        deleteRequest = null
        await tick()
        request.resolve(confirmed)
    }

    async function afterChatDeleted(): Promise<void> {
        closeThisChat()
        await afterFlush()
        list?.focus({ preventScroll: true })
    }

    function openToggles(element: HTMLElement | null, overSheet: boolean, at: FavouriteRef | null = null): void {
        if (surfaceHidden) return
        const chat = character?.chats?.[character.chatPage]
        if (!character || !chat) return
        togglesOpener = element
        togglesOverSheet = overSheet
        togglesAt = at
        togglesTarget = { owner: character, chat }
        togglesOpen = true
    }

    function closeToggles(): void {
        togglesOpen = false
        togglesOverSheet = false
    }

    // The panel belongs to the chat it was opened for: when the shown chat is another one, it closes.
    $effect(() => {
        if (!togglesOpen) return
        const target = togglesTarget
        const shown = character?.chats?.[character.chatPage]
        if (!target || shown !== target.chat) closeToggles()
    })

    // The summary rows read the counts when they are drawn; a source that cannot be read gives no summary instead of breaking the menu.
    function togglesSummary(): string | null {
        const chat = character?.chats?.[character.chatPage]
        if (!togglesModule || !character || !chat) return null
        try {
            const { n, on } = togglesModule.toggleSummary(character, chat)
            return n === 0 ? language.chatShellTogglesNone : language.chatShellTogglesSummary(n, on)
        } catch (error) {
            console.error('The toggle summary could not be read:', error)
            return null
        }
    }

    function openPlus(element: HTMLElement): void {
        if (surfaceHidden) return
        opener = element
        plusOpen = true
    }

    function openActions(request: ActionRequest): void {
        if (surfaceHidden) return
        actionRequest = request
        actionOpen = true
    }

    // The sheet belongs to the row that opened it: when that row goes away the sheet closes with it.
    function closeActions(request: ActionRequest): void {
        if (actionRequest === request) actionOpen = false
    }

    function openCustomize(request: CustomizeRequest): void {
        if (surfaceHidden) return
        customizeRequest = request
        customizeOpen = true
    }

    // The rows read the same tree view, busy state and branch action as the classic screen does.
    let chatTreeView = $derived.by(() => {
        const chat = character?.chats?.[character.chatPage]
        return chat ? treeView(chat) : null
    })
    const getTreeView = () => chatTreeView
    // The refused send of the shown chat, kept in module memory only (never stored); null when none.
    let sendFailure = $derived(sendFailures && character?.type === 'character' ? sendFailures.failureOf(character.chaId, character.chats?.[character.chatPage]?.id) : null)
    function fixSendFailure(): void {
        if (sendFailure?.fix) settingsRoute?.openSettingsForFix(sendFailure.fix)
    }
    function retryShownSendFailure(): void {
        const chatId = character?.chats?.[character.chatPage]?.id
        if (character && chatId) void sendFailures?.retrySendFailure({ chaId: character.chaId, chatId })
    }
    // The card takes room above the composer: while the transcript is at the bottom, it stays at the bottom when the card comes or goes.
    let cardWasShown: boolean | null = null
    $effect(() => {
        const shown = sendFailure !== null
        if (cardWasShown === null) { cardWasShown = shown; return }
        if (shown === cardWasShown) return
        cardWasShown = shown
        if (untrack(() => atBottom)) requestAnimationFrame(() => messageList?.anchorNewestBottom?.())
    })
    const getBusy = () => busy || (composerActions?.isComposerBusy() ?? false)
    const composerSource = { closeMenu: () => {} }
    function branchRow(index: number, expectedId: string | undefined): void {
        void composerActions?.branchAt(composerSource, index, expectedId)
    }
    // The chip and the jump button are inert under any sheet, like the header, the transcript and the composer.
    let sheetBackground = $derived([header, list, composer, jumpHost].filter((element): element is HTMLElement => !!element))
    let confirmBackground = $derived([header, list, composer, jumpHost, sheetLayer].filter((element): element is HTMLElement => !!element))

</script>

<div bind:this={shell} class="default-chat-screen" data-part="chat-shell" data-layout={typeof document !== 'undefined' && document.documentElement.hasAttribute('data-layout') ? undefined : layout} data-input={typeof document !== 'undefined' && document.documentElement.hasAttribute('data-input') ? undefined : inputMode} data-testid="chat-shell-stub" data-find-open={findOpen ? '' : undefined} data-header-concealed={headerConcealed && !findOpen ? '' : undefined} style={customStyle}>
    <div bind:this={header} data-part="chat-header-host">
        {#if findOpen && FindBar && findState}<FindBar bind:this={findBar} query={findState.query} count={findState.hits.length} current={findState.current} complete={findState.complete} filters={findState.filters} characterName={character?.name ?? ''} onquery={onFindQuery} oncomposing={(on) => findCtx?.session.setComposing(on)} onstep={(direction) => findCtx?.session.step(direction)} onclose={() => void closeFind('user')} onclearfilters={onFindClearFilters} onfilters={openFindFilters} onseeall={openFindResults} />
        {:else if ShellHeader}<ShellHeader name={headerName} chatName={headerChatName} hidden={headerHiddenNow} {hardwareKeyboardSeen} onthischat={openThisChat} onconcealed={(concealed) => headerConcealed = concealed} />{/if}
    </div>
    <main bind:this={list} data-part="chat-transcript" tabindex="-1" aria-label={language.chatShellMessages} data-fade={fade} inert={switchPending ? true : undefined} onscroll={scroll}>
        {#if ShellNotices && character?.type === 'character'}<ShellNotices />{/if}
        {#if ShellMessageList && character?.type === 'character'}<ShellMessageList bind:this={messageList} {character} host={list} bind:unread bind:atBottom bind:newCount bind:farFromLatest {readerIntent} {searchHit} searchHitNote={language.chatShellFindMatchInside} {getTreeView} {getBusy} onBranch={branchRow} onOpenActions={openActions} onCloseActions={closeActions} onOpenCustomize={openCustomize} />{/if}
    </main>
    {#if SwitchFrame}<SwitchFrame transcript={list} />{/if}
    <div data-part="chat-announcer" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
    <div bind:this={jumpHost} class="jump-host">
        {#if ReturnChip && chipState.origin}<ReturnChip onreturn={() => void returnFromChip()} onhold={(kind, on) => chip.hold(kind, on)} />{/if}
        {#if ShellFloatingButtons}<ShellFloatingButtons visible={latestButtonVisible({ atBottom, far: farFromLatest, unread, count: newCount })} count={newCount} onclick={jumpFromButton} />{/if}
    </div>
    <div bind:this={composer} data-part="chat-composer-host" inert={switchPending ? true : undefined}>
        {#if SendFailureCard && sendFailure}<SendFailureCard failure={sendFailure} onfix={fixSendFailure} onretry={retryShownSendFailure} />{/if}
        <!-- The key is block identity only: a chat or character switch remounts the notice, so the instance that showed it is gone. -->
        {#if NotificationsOffNotice}{#key chatWindowKey(character?.chaId, shownChat)}<NotificationsOffNotice />{/key}{/if}
        {#if ShellComposer}<ShellComposer onplus={openPlus} onpersona={openPersona} personaexpanded={personaOpen && !personaOverSheet} bind:stickersOpen onhardwarechange={(seen) => { hardwareKeyboardSeen = seen; if (seen) headerHidden = false }} />{/if}
    </div>
    {#if ActionSheet}<ActionSheet open={actionOpen} opener={actionRequest?.opener ?? null} anchor={actionRequest?.anchor} available={actionOpen ? actionRequest?.available() ?? [] : []} disabled={actionOpen ? actionRequest?.disabled() ?? [] : []} generating={actionOpen && actionRequest?.generating() === true} background={sheetBackground} onaction={(id) => actionRequest?.run(id)} onclose={() => actionOpen = false} />{/if}
    {#if CustomizeButtonsSheet}<CustomizeButtonsSheet open={customizeOpen} opener={customizeRequest?.opener ?? null} background={sheetBackground} onchange={() => customizeRequest?.onchange()} onclose={() => customizeOpen = false} />{/if}
    {#if PlusSheet}<PlusSheet open={plusOpen} {opener} background={[header, list, composer].filter((element): element is HTMLElement => !!element)} onclose={() => plusOpen = false} onstickers={() => stickersOpen = !stickersOpen} onchatlist={() => openChatList = true} onmodules={() => openModuleList = true} ontoggles={togglesModule ? (row) => openToggles(opener, false, row ?? null) : undefined} {togglesSummary} />{/if}
    {#if ThisChatSheet}<ThisChatSheet open={thisChatOpen} {opener} background={sheetBackground} target={thisChatTarget} bind:layer={sheetLayer} {confirmDelete} onpersona={openPersonaFromSheet} {togglesSummary} ontoggles={togglesModule ? (element) => openToggles(element, true) : undefined} onmodules={() => openModuleList = true} onjumpsheet={JumpSheet ? openJump : undefined} onsearch={FindBar ? openFind : undefined} onremoved={afterChatDeleted} onclose={closeThisChat} />{/if}
    {#if JumpSheet}<JumpSheet open={jumpOpen} opener={jumpOpener} background={sheetBackground} chat={jumpChat} onjump={(index) => void runJump(index)} onsearch={FindBar ? () => void searchFromJump() : undefined} onclose={closeJump} />{/if}
    {#if FindFiltersSheet}<FindFiltersSheet open={filtersOpen && findOpen} opener={filtersOpener} background={sheetBackground} filters={findState?.filters ?? DEFAULT_FILTERS} characterName={character?.name ?? ''} onfilters={onFindFilters} onclear={onFindClearFilters} onclose={() => filtersOpen = false} />{/if}
    {#if FindResultsSheet}<FindResultsSheet open={resultsOpen && findOpen} opener={resultsOpener} background={sheetBackground} messages={shownChat?.message ?? []} hits={findState?.hits ?? []} query={findState?.query ?? ''} complete={findState?.complete ?? false} thinking={findState?.filters.thinking ?? false} firstText={resultsFirstText} userName={DBState.db.username ?? ''} charName={character?.name ?? ''} userImage={resultsImages.user} charImage={resultsImages.char} onpick={(position) => void showFromResults(position)} onclose={() => resultsOpen = false} />{/if}
    {#if PersonaSheet}<PersonaSheet open={personaOpen} opener={personaOpener} inertOutside={personaOverSheet} variant={personaOverSheet ? 'sheet' : 'dropup'} background={sheetBackground} onclose={() => { personaOpen = false; personaOverSheet = false }} />{/if}
    {#if TogglesPanel}<TogglesPanel open={togglesOpen} opener={togglesOpener} target={togglesTarget} openAt={togglesAt} onclose={closeToggles} />{/if}
    {#if ChatDeleteConfirm && deleteRequest}<ChatDeleteConfirm chat={deleteRequest.chat} busy={deleteRequest.busy} trigger={deleteRequest.trigger} background={confirmBackground} onanswer={(answer: PatternAnswer) => void settleDelete(answer === 'confirm')} />{/if}
</div>

<style>
    [data-part="chat-shell"] { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; background: transparent; color: var(--nexus-text); }
    [data-part="chat-composer-host"] { flex: none; }
    .jump-host { display: contents; }
    [data-part="chat-header-host"] { position: absolute; inset: 0 0 auto 0; z-index: 1; pointer-events: none; }
    [data-part="chat-transcript"] { flex: 1; min-height: 0; overflow-y: auto; padding-top: var(--header-height); scroll-padding-top: var(--header-height); }
    [data-part="chat-shell"][data-header-concealed] [data-part="chat-transcript"] { scroll-padding-top: 0; }
    /* While the bar is open both of its rows are reserved: nothing under it is covered, and typing or stepping never moves the view. */
    [data-part="chat-shell"][data-find-open] [data-part="chat-transcript"] { padding-top: calc(var(--header-height) + var(--size-17)); scroll-padding-top: calc(var(--header-height) + var(--size-17)); }
    [data-part="chat-shell"][data-find-open] :global([data-part="chat-switch-frame"]) { top: calc(var(--header-height) + var(--size-17)); }
    [data-part="chat-announcer"] { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
    [data-part="chat-transcript"][data-fade="a"] { animation: chat-switch-fade-a var(--chat-dur-fast) var(--chat-ease-out); }
    [data-part="chat-transcript"][data-fade="b"] { animation: chat-switch-fade-b var(--chat-dur-fast) var(--chat-ease-out); }
    @keyframes chat-switch-fade-a { from { opacity: 0; } to { opacity: 1; } }
    @keyframes chat-switch-fade-b { from { opacity: 0; } to { opacity: 1; } }
</style>
