<script lang="ts">
    import { onDestroy, tick, untrack } from 'svelte'
    import { get } from 'svelte/store'
    import type { character as Character, Message } from '../../ts/storage/database.svelte'
    import type { TreeView } from '../../ts/process/chatTreeView'
    import { DBState, ReloadChatPointer, ReloadGUIPointer, ScrollToMessageStore, createSimpleCharacter } from '../../ts/stores.svelte'
    import { chatFoldedState, chatFoldedStateMessageIndex } from '../../ts/globalApi.svelte'
    import { firstMessageIndexOf, firstMessageOf, nextFirstMessageIndex } from '../../ts/process/firstMessage'
    import { isActiveStreamReply } from '../../ts/process/activeStreams'
    import { getAdditionalChatLoadPages, getInitialChatLoadPages, pagesOnReturn } from '../../ts/chatLoadPages'
    import { chatWindowKey, createChatWindowPolicy } from '../../ts/chatWindowPolicy'
    import { hasMessageEditorDrafts, onDraftsChanged } from '../../ts/localDrafts'
    import { createBottomFollower, isScrolledToBottom, type BottomFollower, type ProgrammaticScrollMarker } from '../../ts/chatShell/bottomAnchor'
    import { chatSurface,isChatSurfaceInstalled, onSurfaceHiding } from '../ChatScreens/chatSurface.svelte'
    import { recordCaughtError } from '../../ts/caughtErrors'
    import { language } from '../../lang'
    import ShellMessage, { type ActionRequest, type CustomizeRequest } from './ShellMessage.svelte'

    interface Props {
        character: Character
        host: HTMLElement | undefined
        unread?: boolean
        atBottom?: boolean
        scrollMarker?: ProgrammaticScrollMarker
        onStep?: (index: number, expectedId: string | undefined, direction: 'back' | 'forward') => void
        onBranch?: (index: number, expectedId: string | undefined) => void
        getTreeView?: () => TreeView | null
        getBusy?: () => boolean
        onReroll?: () => void
        unReroll?: () => void
        onOpenActions?: (request: ActionRequest) => void
        onCloseActions?: (request: ActionRequest) => void
        onOpenCustomize?: (request: CustomizeRequest) => void
    }
    let { character, host, unread = $bindable(false), atBottom = $bindable(true), scrollMarker, onStep, onBranch, getTreeView, getBusy, onReroll, unReroll, onOpenActions, onCloseActions, onOpenCustomize }: Props = $props()
    // Rows with a modal layer open (the partial-edit overlays are fixed-position inside the row) leave content-visibility so the layer is not clipped to the row.
    let overlayRows = $state<Record<string, true>>({})
    function setOverlay(key: string, open: boolean): void {
        if (open) overlayRows[key] = true
        else delete overlayRows[key]
    }
    let chat = $derived(character.chats?.[character.chatPage])
    // The first message browses the character's stored greetings (fmIndex); it never reaches the reply tree and never generates.
    function firstMessageTreeView(): TreeView {
        const count = (character.alternateGreetings?.length ?? 0) + 1
        const index = chat ? firstMessageIndexOf(character, chat) + 2 : 1
        return { at: (position) => position === -1 ? { index, count } : null, continuation: 0 }
    }
    function stepFirstMessage(step: 1 | -1): void {
        if (chat) chat.fmIndex = nextFirstMessageIndex(character, chat, step)
    }
    let messages = $derived(chat?.message ?? [])
    let loadPages = $state(getInitialChatLoadPages(DBState.db))
    let windowResetToken = $state(0)
    let handledResetToken = 0
    let rows = $state<HTMLDivElement>()
    // Tells the shell that the scroll event following this write is the list's own, not the reader's.
    function wrote(): void {
        if (host) scrollMarker?.mark(host.scrollTop)
    }
    let rebuildEpoch = $state(chatSurface.rebuildEpoch)
    let guiPointer = $state(0)
    let rowPointers = $state<Record<number, number>>({})
    let previousLength = 0
    let previousRoom: string | null = null
    let hideTop: number | null = null
    let hideOwner: string | null = null
    let initialPagesAtHide = getInitialChatLoadPages(DBState.db)
    let wasHidden = false
    const installed = isChatSurfaceInstalled()
    const windowPolicy = createChatWindowPolicy({ initial: () => getInitialChatLoadPages(DBState.db), editorsOpen: hasMessageEditorDrafts })
    const stopDrafts = onDraftsChanged(() => {
        const restored = windowPolicy.onDraftsChanged()
        if (restored !== null) loadPages = restored
    })
    const stopHiding = installed ? onSurfaceHiding(() => {
        hideTop = host?.scrollTop ?? null
        hideOwner = chatWindowKey(character.chaId, chat)
    }) : () => {}
    onDestroy(() => { stopDrafts(); stopHiding() })

    let visibleRows = $derived.by(() => {
        const start = chatFoldedStateMessageIndex.index >= 0 ? chatFoldedStateMessageIndex.index : messages.length - 1
        const end = Math.max(0, start - loadPages)
        const result: { idx: number, message: Message, key: string }[] = []
        for (let i = start; i >= end; i--) {
            const message = messages[i]
            if (message) result.push({ idx: i, message, key: message.chatId ?? `${chat?.id ?? character.chaId}:${i}` })
        }
        return result
    })
    let renderRows = $state<{ idx: number, message: Message, key: string }[]>([])
    function runAt(index: number): 'first' | 'middle' | 'last' | 'single' {
        const role = messages[index]?.role
        const before = index > 0 && messages[index - 1]?.role === role
        const after = index + 1 < messages.length && messages[index + 1]?.role === role
        return before ? (after ? 'middle' : 'last') : (after ? 'first' : 'single')
    }
    $effect(() => {
        if (installed && chatSurface.hidden) {
            // The snapshot taken once at hide time holds raw streaming text while Settings covers the surface.
            untrack(() => { renderRows = renderRows.map((row) => ({ ...row, message: { ...row.message } })) })
            return
        }
        // Shown rows carry the live messages, so a stream chunk re-renders only the row whose data changed.
        renderRows = visibleRows
    })

    $effect.pre(() => {
        const key = chatWindowKey(character.chaId, chat)
        untrack(() => {
            const next = windowPolicy.onKey(key, loadPages)
            if (next.next !== loadPages) loadPages = next.next
            if (next.lowered) windowResetToken += 1
        })
    })

    $effect(() => {
        if (installed && chatSurface.hidden) {
            wasHidden = true
            initialPagesAtHide = untrack(() => getInitialChatLoadPages(DBState.db))
            return
        }
        if (wasHidden) {
            wasHidden = false
            const next = pagesOnReturn(loadPages, initialPagesAtHide, getInitialChatLoadPages(DBState.db))
            if (next.next !== loadPages) loadPages = next.next
            if (next.lowered) windowResetToken += 1
        }
        if (installed && chatSurface.rebuildEpoch !== rebuildEpoch) {
            rebuildEpoch = chatSurface.rebuildEpoch
            guiPointer = chatSurface.heldGui
            rowPointers = chatSurface.heldChat
            if (hideOwner === chatWindowKey(character.chaId, chat) && hideTop !== null && host) { host.scrollTop = hideTop; wrote() }
            hideTop = null
        } else if (installed) {
            guiPointer = chatSurface.heldGui
            rowPointers = chatSurface.heldChat
        } else {
            guiPointer = get(ReloadGUIPointer)
            rowPointers = get(ReloadChatPointer)
        }
    })

    $effect(() => {
        if (installed && chatSurface.hidden) return
        const index = ScrollToMessageStore.value
        if (index < 0) return
        ScrollToMessageStore.value = -1
        loadPages = Math.max(loadPages, messages.length - index + 5)
        void tick().then(() => {
            if (installed && chatSurface.hidden) { ScrollToMessageStore.value = index; return }
            rows?.querySelector(`[data-chat-index="${Math.max(0, index - 3)}"]`)?.scrollIntoView({ behavior: 'instant', block: 'start' })
            wrote()
        })
    })

    $effect(() => {
        if (installed && chatSurface.hidden) return
        if (windowResetToken === handledResetToken) return
        handledResetToken = windowResetToken
        restAtNewest(room())
    })

    $effect(() => {
        if (installed && chatSurface.hidden) return
        const room = chat?.id ?? null
        const length = messages.length
        const same = room === previousRoom
        if (!same) { unread = false; atBottom = true; restAtNewest(room) }
        if (same && length > previousLength && messages[length - 1]?.role === 'char' && DBState.db.autoScrollToNewMessage) {
            if (atBottom || DBState.db.alwaysScrollToNewMessage) void tick().then(scrollToLatestMessage)
            else unread = true
        }
        previousLength = length
        previousRoom = room
    })

    // A reader resting at the bottom stays there while the newest row reaches its final height (a reroll swaps the streaming body for the final one and adds the alternatives row after the scroll ran).
    let follower: BottomFollower | undefined
    $effect(() => {
        if (!host || !rows) return
        const made = createBottomFollower(host, rows, () => DBState.db.autoScrollToNewMessage !== false && !(installed && chatSurface.hidden), wrote)
        follower = made
        return () => { made.dispose(); if (follower === made) follower = undefined }
    })

    export function scrollToLatestMessage() {
        if (installed && chatSurface.hidden) return
        unread = false
        atBottom = true
        rows?.firstElementChild?.scrollIntoView({ behavior: 'instant', block: 'start' })
        wrote()
        follower?.sync()
        follower?.follow()
    }

    export function anchorNewestBottom() {
        if (installed && chatSurface.hidden) return
        rows?.firstElementChild?.scrollIntoView({ behavior: 'instant', block: 'end' })
        wrote()
        follower?.sync()
        follower?.follow()
    }

    function room(): string | null {
        return untrack(() => chat?.id ?? null)
    }

    // The scroller is a normal-direction scroller: scrollTop 0 is the oldest loaded row and the newest rests at the maximum.
    // Opening a chat or resetting its window rests the reader at the newest message whatever the auto-scroll setting says;
    // the setting only governs following later growth. The second pass after a frame covers row heights that settle late,
    // and is skipped once the position is no longer the one this function wrote.
    let destroyed = false
    onDestroy(() => { destroyed = true })
    function placeAtNewest(): number | null {
        if (!host || (installed && chatSurface.hidden)) return null
        if (!isScrolledToBottom(host)) {
            host.scrollTop = Math.max(0, host.scrollHeight - host.clientHeight)
            wrote()
        }
        unread = false
        atBottom = true
        follower?.sync()
        follower?.follow()
        return host.scrollTop
    }
    function restAtNewest(forRoom: string | null): void {
        void tick().then(() => {
            if (destroyed || room() !== forRoom) return
            const placed = placeAtNewest()
            if (placed === null || typeof requestAnimationFrame === 'undefined') return
            requestAnimationFrame(() => {
                if (destroyed || room() !== forRoom || !host || host.scrollTop !== placed) return
                placeAtNewest()
            })
        })
    }

    // Older rows mount above the reader: the distance from the bottom is restored explicitly, not left to CSS scroll anchoring.
    let pendingBottomDistance: number | null = null
    function loadOlder(): void {
        if (!host || pendingBottomDistance !== null) return
        const current = host
        pendingBottomDistance = current.scrollHeight - current.scrollTop
        loadPages += getAdditionalChatLoadPages(DBState.db)
        const restore = () => {
            const target = Math.max(0, current.scrollHeight - (pendingBottomDistance ?? 0))
            if (current.scrollTop !== target) { current.scrollTop = target; wrote() }
            follower?.sync()
            return target
        }
        void tick().then(() => {
            if (destroyed) { pendingBottomDistance = null; return }
            const placed = restore()
            if (typeof requestAnimationFrame === 'undefined') { pendingBottomDistance = null; return }
            requestAnimationFrame(() => {
                if (!destroyed && current.scrollTop === placed) restore()
                pendingBottomDistance = null
            })
        })
    }

    export function onScroll() {
        if (!host || (installed && chatSurface.hidden)) return
        follower?.sync()
        if (host.scrollTop < 100 && messages.length > loadPages) loadOlder()
        const newest = rows?.firstElementChild
        atBottom = !newest || newest.getBoundingClientRect().top <= host.getBoundingClientRect().bottom + 100
        if (atBottom) unread = false
    }
</script>

<div data-part="chat-message-list" class="flex flex-col-reverse" role="log" aria-live="off" bind:this={rows}>
    {#key rebuildEpoch}
        {#each renderRows as row (row.key)}
            <div class="chat-message-container" class:older={row.idx < messages.length - 3 && !overlayRows[row.key]} data-part="chat-message-container">
                <svelte:boundary onerror={(error) => recordCaughtError('chat.message', error)}>
                    <ShellMessage idx={row.idx} message={row.message} chatId={row.message.chatId} name={row.message.role === 'user' ? DBState.db.username : character.name}
                        img={row.message.role === 'user' ? DBState.db.userIcon : character.image}
                        character={createSimpleCharacter(character)} totalLength={messages.length} isLastMemory={Boolean(row.message.chatId && row.message.chatId === chat?.supaMemoryCoveredId)}
                        rerollIcon="dynamic" largePortrait={row.message.role === 'user' ? false : character.largePortrait ?? false}
                        messageGenerationInfo={row.message.generationInfo} role={row.message.role} isComment={row.message.isComment ?? false}
                        disabled={row.message.disabled ?? false} run={runAt(row.idx)} expectedId={row.message.chatId} surface={true}
                        streamingOptimizationMode={chat?.activeStreamingDisplayOptimizationMode ?? DBState.db.streamingDisplayOptimizationMode ?? 'off'}
                        rawStreamingText={row.message.data} isOptimizedStreamingMessage={chat?.isStreaming === true && row.idx === messages.length - 1 && row.message.role === 'char'}
                        streaming={chat?.isStreaming === true && row.idx === messages.length - 1 && row.message.role === 'char' && isActiveStreamReply(row.message.chatId)}
                        interrupted={row.message.interrupted === true && !isActiveStreamReply(row.message.chatId)}
                        deferAutoTranslate={chat?.isStreaming === true && row.idx === messages.length - 1 && isActiveStreamReply(row.message.chatId) && DBState.db.autoTranslate === true}
                        guiRevision={guiPointer + (rowPointers[row.idx] ?? 0)} {onStep} {onBranch} {getTreeView} {getBusy} {onReroll} {unReroll} {onOpenActions} {onCloseActions} {onOpenCustomize} onOverlay={(open) => setOverlay(row.key, open)} />
                    {#snippet failed(_error, reset)}
                        <div data-part="chat-message-failed" role="note">{row.message.data}<p>{language.messageRenderFailed}</p><button onclick={reset}>{language.messageRenderRetry}</button></div>
                    {/snippet}
                </svelte:boundary>
            </div>
        {/each}
        {#if chat && messages.length <= loadPages && character.type === 'character'}
            <div data-part="chat-first-message">
                <svelte:boundary onerror={(error) => recordCaughtError('chat.message', error)}>
                    <ShellMessage idx={-1} message={{ role: 'char', data: firstMessageOf(character, chat) }} name={character.name} img={character.image} character={createSimpleCharacter(character)} firstMessage getTreeView={firstMessageTreeView} onReroll={() => stepFirstMessage(1)} unReroll={() => stepFirstMessage(-1)} {onOpenActions} {onCloseActions} {onOpenCustomize} />
                    {#snippet failed(_error, reset)}<div role="note">{language.messageRenderFailed}<button onclick={reset}>{language.messageRenderRetry}</button></div>{/snippet}
                </svelte:boundary>
            </div>
        {/if}
    {/key}
    {#if chatFoldedStateMessageIndex.index !== -1}
        <button data-part="chat-load-more" onclick={() => { loadPages += chatFoldedStateMessageIndex.index + 1; chatFoldedState.data = null }}>{language.loadMore}</button>
    {/if}
</div>

<style>
    [data-part="chat-message-container"].older { content-visibility: auto; contain-intrinsic-size: auto var(--size-39); }
</style>
