<script lang="ts">
    import { onMount } from 'svelte'
    import '../../styles/chat-tokens.css'
    import { DBState, selIdState } from '../../ts/stores.svelte'
    import { language } from '../../lang'
    import type ShellHeaderComponent from './ShellHeader.svelte'
    import type ShellComposerComponent from './ShellComposer.svelte'
    import type PersonaSheetComponent from './PersonaSheet.svelte'
    import type PlusSheetComponent from './PlusSheet.svelte'
    import type ShellNoticesComponent from './ShellNotices.svelte'
    import type ShellFloatingButtonsComponent from './ShellFloatingButtons.svelte'
    import type ShellMessageListComponent from './ShellMessageList.svelte'
    import type ActionSheetComponent from './ActionSheet.svelte'
    import type CustomizeButtonsSheetComponent from './CustomizeButtonsSheet.svelte'
    import type { ActionRequest, CustomizeRequest } from './ShellMessage.svelte'
    import { shouldAnchorBottom } from '../../ts/chatShell/bottomAnchor'
    import { bindReaderIntent, canHostMove, createReaderIntent } from '../../ts/chatShell/readerIntent'
    import { watchSoftKeyboard } from '../../ts/chatShell/softKeyboard'
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
    let ShellNotices: typeof ShellNoticesComponent | null = $state(null)
    let ShellFloatingButtons: typeof ShellFloatingButtonsComponent | null = $state(null)
    let ShellMessageList: typeof ShellMessageListComponent | null = $state(null)
    let ActionSheet: typeof ActionSheetComponent | null = $state(null)
    let CustomizeButtonsSheet: typeof CustomizeButtonsSheetComponent | null = $state(null)
    let composerActions: typeof import('../../ts/process/composerActions.svelte') | null = null
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
    let headerHidden = $state(false)
    let hardwareKeyboardSeen = $state(false)
    // The header hides while the soft keyboard is open; the scroll rule (headerHidden) keeps its own state underneath, so
    // closing the keyboard returns to what the scroll rule wants.
    let keyboardOpen = $state(false)
    let personaOpen = $state(false)
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
        return watchSoftKeyboard(shell, window, (open) => { keyboardOpen = open })
    })

    $effect(() => {
        if (!surface) return
        surfaceHidden = surface.hidden
        const epoch = surface.closeEpoch
        if (epoch !== seenCloseEpoch) {
            seenCloseEpoch = epoch
            plusOpen = false
            stickersOpen = false
            actionOpen = false
            customizeOpen = false
        }
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
        opener = element
        personaOpen = true
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
    const getBusy = () => busy || (composerActions?.isComposerBusy() ?? false)
    const composerSource = { closeMenu: () => {} }
    function branchRow(index: number, expectedId: string | undefined): void {
        void composerActions?.branchAt(composerSource, index, expectedId)
    }
    let sheetBackground = $derived([header, list, composer].filter((element): element is HTMLElement => !!element))

</script>

<div bind:this={shell} class="default-chat-screen" data-part="chat-shell" data-layout={typeof document !== 'undefined' && document.documentElement.hasAttribute('data-layout') ? undefined : layout} data-input={typeof document !== 'undefined' && document.documentElement.hasAttribute('data-input') ? undefined : inputMode} data-testid="chat-shell-stub" data-header-concealed={headerConcealed ? '' : undefined} style={customStyle}>
    <div bind:this={header} data-part="chat-header-host">
        {#if ShellHeader}<ShellHeader name={character?.name ?? ''} hidden={headerHiddenNow} {hardwareKeyboardSeen} onpersona={openPersona} onconcealed={(concealed) => headerConcealed = concealed} />{/if}
    </div>
    <main bind:this={list} data-part="chat-transcript" aria-label={language.chatShellMessages} onscroll={scroll}>
        {#if ShellNotices && character?.type === 'character'}<ShellNotices />{/if}
        {#if ShellMessageList && character?.type === 'character'}<ShellMessageList bind:this={messageList} {character} host={list} bind:unread bind:atBottom {readerIntent} {getTreeView} {getBusy} onBranch={branchRow} onOpenActions={openActions} onCloseActions={closeActions} onOpenCustomize={openCustomize} />{/if}
    </main>
    {#if ShellFloatingButtons}<ShellFloatingButtons visible={unread && !atBottom} onclick={() => messageList?.scrollToLatestMessage?.()} />{/if}
    <div bind:this={composer} data-part="chat-composer-host">
        {#if ShellComposer}<ShellComposer onplus={openPlus} onpersona={openPersona} bind:stickersOpen onhardwarechange={(seen) => { hardwareKeyboardSeen = seen; if (seen) headerHidden = false }} />{/if}
    </div>
    {#if ActionSheet}<ActionSheet open={actionOpen} opener={actionRequest?.opener ?? null} anchor={actionRequest?.anchor} available={actionOpen ? actionRequest?.available() ?? [] : []} disabled={actionOpen ? actionRequest?.disabled() ?? [] : []} generating={actionOpen && actionRequest?.generating() === true} background={sheetBackground} onaction={(id) => actionRequest?.run(id)} onclose={() => actionOpen = false} />{/if}
    {#if CustomizeButtonsSheet}<CustomizeButtonsSheet open={customizeOpen} opener={customizeRequest?.opener ?? null} background={sheetBackground} onchange={() => customizeRequest?.onchange()} onclose={() => customizeOpen = false} />{/if}
    {#if PersonaSheet}<PersonaSheet open={personaOpen} {opener} background={[header, list, composer].filter((element): element is HTMLElement => !!element)} onclose={() => personaOpen = false} />{/if}
    {#if PlusSheet}<PlusSheet open={plusOpen} {opener} background={[header, list, composer].filter((element): element is HTMLElement => !!element)} onclose={() => plusOpen = false} onstickers={() => stickersOpen = !stickersOpen} onchatlist={() => openChatList = true} onmodules={() => openModuleList = true} />{/if}
</div>

<style>
    [data-part="chat-shell"] { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; background: transparent; color: var(--nexus-text); }
    [data-part="chat-composer-host"] { flex: none; }
    [data-part="chat-header-host"] { position: absolute; inset: 0 0 auto 0; z-index: 1; pointer-events: none; }
    [data-part="chat-transcript"] { flex: 1; min-height: 0; overflow-y: auto; padding-top: var(--header-height); scroll-padding-top: var(--header-height); }
    [data-part="chat-shell"][data-header-concealed] [data-part="chat-transcript"] { scroll-padding-top: 0; }
</style>
