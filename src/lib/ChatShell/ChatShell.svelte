<script lang="ts">
    import { onMount, tick, untrack } from 'svelte'
    import { afterFlush } from '../../ts/afterFlush'
    import '../../styles/chat-tokens.css'
    import { DBState, selIdState } from '../../ts/stores.svelte'
    import { language } from '../../lang'
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
    import type ShellMessageListComponent from './ShellMessageList.svelte'
    import type SwitchFrameComponent from './SwitchFrame.svelte'
    import type { SwitchTargetState } from '../../ts/chatShell/switchTarget.svelte'
    import type ActionSheetComponent from './ActionSheet.svelte'
    import type CustomizeButtonsSheetComponent from './CustomizeButtonsSheet.svelte'
    import type { ActionRequest, CustomizeRequest } from './ShellMessage.svelte'
    import { shouldAnchorBottom } from '../../ts/chatShell/bottomAnchor'
    import { bindReaderIntent, canHostMove, createReaderIntent } from '../../ts/chatShell/readerIntent'
    import { watchSoftKeyboard } from '../../ts/chatShell/softKeyboard'
    import { lowPowerMarked } from '../../ts/chatShell/lowPower'
    import { hostIme } from '../../ts/android/hostBridge'
    import { treeView } from '../../ts/process/chatTreeView'

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

    // The fade is an animation: reduced motion (the OS setting or the app's `rm` class) and low power switch it off, so the attribute that starts it is never set.
    function fadeAllowed(): boolean {
        const root = document.documentElement
        if (root.classList.contains('rm') || lowPowerMarked(root)) return false
        return !(typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    }

    $effect(() => {
        if (!surface) return
        surfaceHidden = surface.hidden
        const epoch = surface.closeEpoch
        if (epoch !== seenCloseEpoch) {
            seenCloseEpoch = epoch
            plusOpen = false
            closeThisChat()
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
            layout = window.innerWidth >= 900 ? 'wide' : window.innerWidth >= 600 ? 'mid' : 'phone'
            inputMode = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ? 'hover' : 'touch'
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
    let sheetBackground = $derived([header, list, composer].filter((element): element is HTMLElement => !!element))
    let confirmBackground = $derived([header, list, composer, sheetLayer].filter((element): element is HTMLElement => !!element))

</script>

<div bind:this={shell} class="default-chat-screen" data-part="chat-shell" data-layout={typeof document !== 'undefined' && document.documentElement.hasAttribute('data-layout') ? undefined : layout} data-input={typeof document !== 'undefined' && document.documentElement.hasAttribute('data-input') ? undefined : inputMode} data-testid="chat-shell-stub" data-header-concealed={headerConcealed ? '' : undefined} style={customStyle}>
    <div bind:this={header} data-part="chat-header-host">
        {#if ShellHeader}<ShellHeader name={headerName} chatName={headerChatName} hidden={headerHiddenNow} {hardwareKeyboardSeen} onthischat={openThisChat} onconcealed={(concealed) => headerConcealed = concealed} />{/if}
    </div>
    <main bind:this={list} data-part="chat-transcript" tabindex="-1" aria-label={language.chatShellMessages} data-fade={fade} inert={switchPending ? true : undefined} onscroll={scroll}>
        {#if ShellNotices && character?.type === 'character'}<ShellNotices />{/if}
        {#if ShellMessageList && character?.type === 'character'}<ShellMessageList bind:this={messageList} {character} host={list} bind:unread bind:atBottom {readerIntent} {getTreeView} {getBusy} onBranch={branchRow} onOpenActions={openActions} onCloseActions={closeActions} onOpenCustomize={openCustomize} />{/if}
    </main>
    {#if SwitchFrame}<SwitchFrame transcript={list} />{/if}
    <div data-part="chat-announcer" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
    {#if ShellFloatingButtons}<ShellFloatingButtons visible={unread && !atBottom} onclick={() => messageList?.scrollToLatestMessage?.()} />{/if}
    <div bind:this={composer} data-part="chat-composer-host" inert={switchPending ? true : undefined}>
        {#if SendFailureCard && sendFailure}<SendFailureCard failure={sendFailure} onfix={fixSendFailure} onretry={retryShownSendFailure} />{/if}
        <!-- The key is block identity only: a chat or character switch remounts the notice, so the instance that showed it is gone. -->
        {#if NotificationsOffNotice}{#key chatWindowKey(character?.chaId, shownChat)}<NotificationsOffNotice />{/key}{/if}
        {#if ShellComposer}<ShellComposer onplus={openPlus} onpersona={openPersona} bind:stickersOpen onhardwarechange={(seen) => { hardwareKeyboardSeen = seen; if (seen) headerHidden = false }} />{/if}
    </div>
    {#if ActionSheet}<ActionSheet open={actionOpen} opener={actionRequest?.opener ?? null} anchor={actionRequest?.anchor} available={actionOpen ? actionRequest?.available() ?? [] : []} disabled={actionOpen ? actionRequest?.disabled() ?? [] : []} generating={actionOpen && actionRequest?.generating() === true} background={sheetBackground} onaction={(id) => actionRequest?.run(id)} onclose={() => actionOpen = false} />{/if}
    {#if CustomizeButtonsSheet}<CustomizeButtonsSheet open={customizeOpen} opener={customizeRequest?.opener ?? null} background={sheetBackground} onchange={() => customizeRequest?.onchange()} onclose={() => customizeOpen = false} />{/if}
    {#if PlusSheet}<PlusSheet open={plusOpen} {opener} background={[header, list, composer].filter((element): element is HTMLElement => !!element)} onclose={() => plusOpen = false} onstickers={() => stickersOpen = !stickersOpen} onchatlist={() => openChatList = true} onmodules={() => openModuleList = true} ontoggles={togglesModule ? (row) => openToggles(opener, false, row ?? null) : undefined} {togglesSummary} />{/if}
    {#if ThisChatSheet}<ThisChatSheet open={thisChatOpen} {opener} background={sheetBackground} target={thisChatTarget} bind:layer={sheetLayer} {confirmDelete} onpersona={openPersonaFromSheet} {togglesSummary} ontoggles={togglesModule ? (element) => openToggles(element, true) : undefined} onmodules={() => openModuleList = true} onremoved={afterChatDeleted} onclose={closeThisChat} />{/if}
    {#if PersonaSheet}<PersonaSheet open={personaOpen} opener={personaOpener} inertOutside={personaOverSheet} background={sheetBackground} onclose={() => { personaOpen = false; personaOverSheet = false }} />{/if}
    {#if TogglesPanel}<TogglesPanel open={togglesOpen} opener={togglesOpener} target={togglesTarget} openAt={togglesAt} onclose={closeToggles} />{/if}
    {#if ChatDeleteConfirm && deleteRequest}<ChatDeleteConfirm chat={deleteRequest.chat} busy={deleteRequest.busy} trigger={deleteRequest.trigger} background={confirmBackground} onanswer={(answer: PatternAnswer) => void settleDelete(answer === 'confirm')} />{/if}
</div>

<style>
    [data-part="chat-shell"] { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; background: transparent; color: var(--nexus-text); }
    [data-part="chat-composer-host"] { flex: none; }
    [data-part="chat-header-host"] { position: absolute; inset: 0 0 auto 0; z-index: 1; pointer-events: none; }
    [data-part="chat-transcript"] { flex: 1; min-height: 0; overflow-y: auto; padding-top: var(--header-height); scroll-padding-top: var(--header-height); }
    [data-part="chat-shell"][data-header-concealed] [data-part="chat-transcript"] { scroll-padding-top: 0; }
    [data-part="chat-announcer"] { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
    [data-part="chat-transcript"][data-fade="a"] { animation: chat-switch-fade-a var(--chat-dur-fast) var(--chat-ease-out); }
    [data-part="chat-transcript"][data-fade="b"] { animation: chat-switch-fade-b var(--chat-dur-fast) var(--chat-ease-out); }
    @keyframes chat-switch-fade-a { from { opacity: 0; } to { opacity: 1; } }
    @keyframes chat-switch-fade-b { from { opacity: 0; } to { opacity: 1; } }
</style>
