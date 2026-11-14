<script lang="ts">
    import { flushSync, onDestroy, untrack } from 'svelte'
    import { afterFlush } from '../../ts/afterFlush'
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
    import { createBottomFollower, isScrolledToBottom, type BottomFollower } from '../../ts/chatShell/bottomAnchor'
    import { bindReaderIntent, canHostMove, createReaderIntent, type ReaderIntentSource } from '../../ts/chatShell/readerIntent'
    import { JUMP_HOLD_MS, WRITE_EPSILON, createLoadRealign, viewportTopRow } from '../../ts/chatShell/loadRealign'
    import { STEP_HOLD_MOUNT_CAP, createStepHold, heldPin, pagesForPin, type PinRelease, type StepRowRunner } from '../../ts/chatShell/stepHold'
    import { afterAppend, foldLoadMorePages, jumpOnlyGrows, jumpWindow,mountCap, newestWindow, normalizeBottom, shellInitialPages, shellPages, shellWindow, slideNewer, slideOlder, trimHeld } from '../../ts/chatShell/mountWindow'
    import { chatSurface,isChatSurfaceInstalled, onSurfaceHiding } from '../ChatScreens/chatSurface.svelte'
    import { offscreenRowCounts } from '../../ts/chatShell/offscreenRows'
    import { asShellFocus } from '../../ts/chatShell/shellFocus'
    import { alignDelta, appendedReplies, createTravel, distanceFromEnd, isAtBottom, isFar, parseInset, travelPlan, type JumpAlign, type JumpOptions, type JumpOrigin, type JumpResult, type JumpStatus } from '../../ts/chatShell/jumpTarget'
    import { recordCaughtError } from '../../ts/caughtErrors'
    import { holdWarmAsks } from '../ChatScreens/deferredAssetImages'
    import { language } from '../../lang'
    import ShellMessage, { type ActionRequest, type CustomizeRequest } from './ShellMessage.svelte'

    interface Props {
        character: Character
        host: HTMLElement | undefined
        unread?: boolean
        atBottom?: boolean
        // Character replies that arrived while the reader was away from the bottom; it clears at the bottom and with a chat switch.
        newCount?: number
        // The reader is more than one screen from the newest message, or the window does not mount it.
        farFromLatest?: boolean
        // The shell's reader-intent source; a list mounted on its own binds one to its host.
        readerIntent?: ReaderIntentSource
        onBranch?: (index: number, expectedId: string | undefined) => void
        getTreeView?: () => TreeView | null
        getBusy?: () => boolean
        onReroll?: () => void
        unReroll?: () => void
        onOpenActions?: (request: ActionRequest) => void
        onCloseActions?: (request: ActionRequest) => void
        onOpenCustomize?: (request: CustomizeRequest) => void
    }
    let { character, host, unread = $bindable(false), atBottom = $bindable(true), newCount = $bindable(0), farFromLatest = $bindable(false), readerIntent, onBranch, getTreeView, getBusy, onReroll, unReroll, onOpenActions, onCloseActions, onOpenCustomize }: Props = $props()
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
    // At most this many articles are mounted, the first message included; the page-size settings are read clamped to it and never written.
    const CAP = mountCap(false)
    const initialPages = (): number => shellInitialPages(getInitialChatLoadPages(DBState.db), CAP)
    let loadPages = $state(initialPages())
    // The absolute newest mounted index while the window is slid off the newest message; null means the window tracks the newest message.
    let bottom = $state<number | null>(null)
    // A reply arrived while the reader was away from the newest message. `unread` is this flag, or a window that does not mount the newest message.
    let replyUnread = $state(false)
    let windowResetToken = $state(0)
    let handledResetToken = 0
    let rows = $state<HTMLDivElement>()
    let rebuildEpoch = $state(chatSurface.rebuildEpoch)
    let guiPointer = $state(0)
    let rowPointers = $state<Record<number, number>>({})
    let previousLength = 0
    let previousRoom: string | null = null
    let hideTop: number | null = null
    let hideOwner: string | null = null
    let initialPagesAtHide = initialPages()
    let wasHidden = false
    const installed = isChatSurfaceInstalled()
    const windowPolicy = createChatWindowPolicy({ initial: initialPages, editorsOpen: hasMessageEditorDrafts })
    const stopDrafts = onDraftsChanged(() => {
        const restored = windowPolicy.onDraftsChanged()
        if (restored !== null) loadPages = restored
    })
    const stopHiding = installed ? onSurfaceHiding(() => {
        hideTop = host?.scrollTop ?? null
        hideOwner = chatWindowKey(character.chaId, chat)
        realign.cancel()
    }) : () => {}
    // While an alternative step runs, the oldest mounted position is frozen at this value (-1 is the first message); null means the window follows loadPages.
    let pin = $state<number | null>(null)
    // The page count when the pin was taken; a different count at commit time was written by someone else while the window was pinned.
    let pinnedLoadPages = 0
    // The window's first row when the pin was taken; growth past the mount cap since then ends the hold of the pinned window.
    // It is written only together with `pin`, whose change re-evaluates every reader, so it is held in a plain object that Svelte does not track.
    const pinned = { start: 0 }
    // The mounted window: the one source of the first row, last row, first-message presence and pin for every reader below.
    let win = $derived(shellWindow({ fold: chatFoldedStateMessageIndex.index, length: messages.length, bottom, pages: loadPages, pin, pinnedStart: pinned.start, holdCap: STEP_HOLD_MOUNT_CAP }))
    let intentSeq = 0
    const requestFrame = (callback: () => void): number => typeof requestAnimationFrame === 'function' ? requestAnimationFrame(callback) : window.setTimeout(callback, 16)
    const cancelFrame = (id: number): void => { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id); else window.clearTimeout(id) }
    const hold = createStepHold({
        host: () => host,
        active: () => !(installed && chatSurface.hidden),
        follower: () => follower,
        content: () => rows,
        newestIndex: () => messages.length - 1,
        pin: () => pin,
        setPin: (value) => {
            if (value !== null && pin === null) {
                pinnedLoadPages = loadPages
                pinned.start = win.start
            }
            pin = value
        },
        windowPin: () => win.windowPin,
        // Releasing the pin keeps the window's oldest position: the same rows stay mounted, so nothing moves under the reader.
        // A page count written meanwhile (a jump to an older message, load more, a full window for a screenshot) asked for more rows, so the larger count wins.
        // A longer chain keeps every row from the pin to its newest message mounted, and that count stays after the hold.
        // Past the mount cap the pin is dropped and the page count stays as it was: the ordinary window is already what renders.
        // A kept window above the mount cap is trimmed back to it by unmounting off-screen rows, the newest first; the trim is rendered before returning,
        // because the caller corrects the stepped row's top right after the commit.
        commitPin: (held): PinRelease => {
            const start = win.start
            if (heldPin(held, pinned.start, start, STEP_HOLD_MOUNT_CAP) === null) {
                pin = null
                return loadPages === pinnedLoadPages ? 'newest' : 'released'
            }
            const kept = pagesForPin(start, messages.length, loadPages, held)
            const pages = loadPages === pinnedLoadPages ? kept : Math.max(kept, loadPages)
            const folded = chatFoldedStateMessageIndex.index >= 0
            const counts = host ? offscreenCounts(host) : { newer: 0, older: 0 }
            const trimmed = trimHeld({ start, pages, length: messages.length, cap: CAP, offscreenNewer: folded ? 0 : counts.newer, offscreenOlder: counts.older, editorsOpen: hasMessageEditorDrafts() })
            loadPages = trimmed.pages
            if (!folded) bottom = trimmed.bottom
            pin = null
            if (trimmed.trimmedNewer > 0 || trimmed.trimmedOlder > 0) flushSync()
            return 'kept'
        },
        landAtNewest: (focusFrom) => {
            placeAtNewest()
            if (focusFrom === null) return
            // Focus follows the view only from the row the reader stepped: a reader who moved focus elsewhere meanwhile keeps it.
            // The newest row is the first article in document order, and the shell-focus mark keeps the follower from reading this as the reader leaving.
            const active = document.activeElement
            const stranded = !active || active === document.body || !active.isConnected || active.closest<HTMLElement>('article[data-part="chat-message"]')?.dataset.chatIndex === String(focusFrom)
            const newest = rows?.querySelector<HTMLElement>('article[data-part="chat-message"]')
            if (stranded && newest) asShellFocus(() => newest.focus({ preventScroll: true }))
        },
        row: (idx) => rows?.querySelector<HTMLElement>(`article[data-chat-index="${idx}"]`) ?? null,
        intentSeq: () => intentSeq,
        tick: afterFlush,
        requestFrame,
        cancelFrame,
    })
    // After a load-older restore the top row is held where the restore put it while the older rows' estimated heights resolve.
    // Every dependency is read at check time, so a hold, a follower, a hidden surface or reader intent ends the window.
    const realign = createLoadRealign({
        host: () => host,
        rows: () => rows,
        active: () => !(installed && chatSurface.hidden),
        intentSeq: () => intentSeq,
        held: () => hold.isInFlight(),
        following: () => follower?.isFollowing() ?? false,
        setTimer: (callback, ms) => window.setTimeout(callback, ms),
        clearTimer: (id) => window.clearTimeout(id),
        observe: (observed, callback) => {
            if (typeof ResizeObserver === 'undefined') return () => {}
            const observer = new ResizeObserver(() => callback())
            observer.observe(observed)
            return () => observer.disconnect()
        },
        requestFrame,
        cancelFrame,
    })
    // A step owns the position from its first call, so the window ends before the hold takes its measurements.
    const runStep: StepRowRunner = (idx, step) => {
        realign.cancel()
        return hold.run(idx, step)
    }
    onDestroy(() => { stopDrafts(); stopHiding(); hold.cancel(); realign.cancel() })

    let visibleRows = $derived.by(() => {
        const result: { idx: number, message: Message, key: string }[] = []
        for (let i = win.start; i >= win.end; i--) {
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

    // The warm hold of the list that is opening (see holdWarmAsks): taken before the new rows exist, so their loaders wait for it.
    // Plain variables on purpose: nothing renders from them, and the effects that write them must not depend on them.
    let openWarmHold: (() => void) | null = null
    let openWarmFrame: number | null = null
    function takeOpenWarmHold(): void {
        // The pending hold keeps living through the loaders that wait on it; only its list signal is given here.
        openWarmHold?.()
        if (openWarmFrame !== null) { cancelFrame(openWarmFrame); openWarmFrame = null }
        openWarmHold = holdWarmAsks()
    }
    // Releases `which` and empties the slot only when `which` is still the pending hold, so a stale signal cannot end a newer one.
    function releaseOpenWarmHold(which: (() => void) | null): void {
        which?.()
        if (which !== null && openWarmHold === which) openWarmHold = null
    }
    onDestroy(() => {
        if (openWarmFrame !== null) { cancelFrame(openWarmFrame); openWarmFrame = null }
        releaseOpenWarmHold(openWarmHold)
    })

    let heldKey: string | undefined
    $effect.pre(() => {
        const key = chatWindowKey(character.chaId, chat)
        untrack(() => {
            // Every chat the list opens, the first one included, holds its warm images until the rows have placed and rendered.
            if (key !== heldKey) takeOpenWarmHold()
            // A hold pending across a chat change would commit the old chat's pin against the new chat's rows, so it is dropped before the new window renders.
            // The other chat opens at its newest message, so a window slid in this chat is not carried over.
            if (heldKey !== undefined && key !== heldKey) { hold.cancel(); realign.cancel(); bottom = null }
            heldKey = key
            const next = windowPolicy.onKey(key, loadPages)
            if (next.next !== loadPages) loadPages = next.next
            if (next.lowered) windowResetToken += 1
        })
    })

    $effect(() => {
        if (installed && chatSurface.hidden) {
            wasHidden = true
            initialPagesAtHide = untrack(initialPages)
            return
        }
        if (wasHidden) {
            wasHidden = false
            const next = pagesOnReturn(loadPages, initialPagesAtHide, initialPages())
            // A changed page size replaces the window, so a slid window goes back to the newest message with it.
            if (next.next !== loadPages) { loadPages = next.next; bottom = null }
            if (next.lowered) windowResetToken += 1
        }
        if (installed && chatSurface.rebuildEpoch !== rebuildEpoch) {
            // The hold comes before `rebuildEpoch` re-keys the rows, so every remounted row's loader waits for it.
            takeOpenWarmHold()
            rebuildEpoch = chatSurface.rebuildEpoch
            guiPointer = chatSurface.heldGui
            rowPointers = chatSurface.heldChat
            if (hideOwner === chatWindowKey(character.chaId, chat) && hideTop !== null && host) { host.scrollTop = hideTop; if (!isScrolledToBottom(host)) follower?.release() }
            // The list signal is one frame after the restore, restored or not; the remounted rows' scans still have to follow.
            const forHold = openWarmHold
            openWarmFrame = requestFrame(() => { openWarmFrame = null; releaseOpenWarmHold(forHold) })
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
        untrack(() => settlePendingJump('cancelled'))
        // A target far from the newest message slides the window around it instead of mounting every row between.
        // While an editor is open nothing unmounts, so a window the jump would slide stays where it is and the target scrolls only when it is already mounted.
        const folded = chatFoldedStateMessageIndex.index >= 0
        const jumped = jumpWindow(index, messages.length, loadPages, CAP)
        if (!hasMessageEditorDrafts() || jumpOnlyGrows(win.slid, folded, jumped, loadPages)) {
            loadPages = jumped.pages
            if (!folded) bottom = jumped.bottom
        }
        void afterFlush().then(() => {
            if (installed && chatSurface.hidden) { ScrollToMessageStore.value = index; return }
            const target = rows?.querySelector(`[data-chat-index="${Math.max(0, index - 3)}"]`)
            if (!target) return
            realign.cancel()
            target.scrollIntoView({ behavior: 'instant', block: 'start' })
            // The app moved the reader away from the newest message on purpose; arriving at the bottom re-enters following.
            follower?.release()
            follower?.sync()
        })
    })

    // A `jumpTo` request waits here for the effect below. At most one waits: a newer request, or a store request, settles it `cancelled`.
    // A request made while the surface is hidden has already answered `deferred`; it stays here and runs when the surface is shown.
    interface PendingJump {
        index: number
        align: JumpAlign
        recordOrigin: boolean
        generation: number
        forRoom: string | null
        intentAtStart: number
        settle: ((result: JumpResult) => void) | null
    }
    let pendingJump: PendingJump | null = null
    let jumpRequestToken = $state(0)
    function settlePendingJump(status: JumpStatus): void {
        const waiting = pendingJump
        pendingJump = null
        waiting?.settle?.({ status, from: null, to: waiting.index })
    }
    onDestroy(() => settlePendingJump('cancelled'))

    $effect(() => {
        void jumpRequestToken
        if (installed && chatSurface.hidden) return
        const request = pendingJump
        if (!request) return
        pendingJump = null
        void runJump(request)
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
        if (!same) { replyUnread = false; atBottom = true; newCount = 0; farFromLatest = false; restAtNewest(room) }
        if (same && length > previousLength) {
            const resting = untrack(() => atBottom)
            // The auto-scroll setting decides only whether a reader at the bottom is followed; a reply the reader is not following is counted either way.
            const follows = messages[length - 1]?.role === 'char' && DBState.db.autoScrollToNewMessage && (resting || DBState.db.alwaysScrollToNewMessage)
            if (follows) void afterFlush().then(scrollToLatestMessage)
            else if (!resting) {
                replyUnread = true
                const replies = appendedReplies(messages, previousLength)
                untrack(() => { newCount += replies })
            }
        }
        previousLength = length
        previousRoom = room
    })

    // A reader resting at the bottom stays there while the newest row reaches its final height (a reroll swaps the streaming body for the final one and adds the alternatives row after the scroll ran).
    let follower: BottomFollower | undefined

    // A message appended while the reader is not following never unmounts a mounted row: the window grows to the cap, then freezes with the newest message unmounted.
    // The first run and the first run after a chat switch only record the length, so opening a chat is not an append; the key-change effect has already reset the window.
    // A step hold owns the window until its commit, so a length change during one is only recorded.
    let appendSeen: { room: string | null, length: number } | null = null
    $effect.pre(() => {
        const room = chat?.id ?? null
        const length = messages.length
        untrack(() => {
            bottom = normalizeBottom(bottom, length)
            if (appendSeen !== null && appendSeen.room === room && length > appendSeen.length && !hold.isInFlight() && pin === null) {
                const next = afterAppend({ fold: chatFoldedStateMessageIndex.index, previousLength: appendSeen.length, length, bottom, pages: loadPages, following: follower ? follower.isFollowing() : true, cap: CAP })
                if (next.pages !== loadPages) loadPages = next.pages
                if (next.bottom !== bottom) bottom = next.bottom
            }
            appendSeen = { room, length }
        })
    })
    // A window that does not mount the newest message shows the new-message button and is never at the bottom of the conversation.
    $effect.pre(() => {
        const slid = win.slid
        unread = replyUnread || slid
        if (slid) { atBottom = false; farFromLatest = true }
    })
    $effect(() => {
        if (!host || !rows) return
        const current = host
        let unbind = () => {}
        let source = readerIntent
        if (!source) {
            const own = createReaderIntent({ canMove: (direction) => canHostMove(current, direction) })
            unbind = bindReaderIntent(current, own)
            source = own
        }
        const stopIntentCount = source.subscribe(() => { intentSeq += 1 })
        const made = createBottomFollower(host, rows, () => DBState.db.autoScrollToNewMessage !== false && !(installed && chatSurface.hidden), source, () => messages.length - 1, () => hold.isInFlight(), () => !win.slid)
        follower = made
        return () => { made.dispose(); stopIntentCount(); unbind(); if (follower === made) follower = undefined }
    })

    export function scrollToLatestMessage() {
        if (installed && chatSurface.hidden) return
        // Rebuilding a slid window unmounts rows, which an open editor forbids; the new-message button stays until the editor closes.
        if (win.slid && hasMessageEditorDrafts()) return
        replyUnread = false
        newCount = 0
        // A slid window is rebuilt around the newest messages first, so the cut lands on a mounted newest row.
        if (win.slid) rebuildNewestWindow()
        atBottom = true
        farFromLatest = false
        realign.cancel()
        rows?.firstElementChild?.scrollIntoView({ behavior: 'instant', block: 'start' })
        follower?.sync()
        follower?.follow()
    }

    function rebuildNewestWindow(): void {
        const fresh = newestWindow(initialPages(), CAP)
        bottom = fresh.bottom
        loadPages = fresh.pages
        flushSync()
    }

    // The button and the End key travel to the newest message. A step hold owns the position while it runs, so a jump waits for it
    // (a bounded number of frames) instead of writing under its pin; reader input, a chat switch, a hidden surface or a newer jump drop the wait.
    const HOLD_WAIT_FRAMES = 30
    let jumpGeneration = 0
    let traveling = false
    // The glide re-reads the live end every frame: the content under the reader keeps growing while a reply streams.
    let travelStops: () => boolean = () => true
    const travel = createTravel({
        requestFrame,
        cancelFrame,
        now: () => performance.now(),
        read: () => ({ top: host?.scrollTop ?? 0, end: host ? Math.max(0, host.scrollHeight - host.clientHeight) : 0 }),
        write: (value) => { if (host) host.scrollTop = value },
        stop: () => travelStops(),
    })
    onDestroy(() => travel.cancel())

    function waitForHold(abandoned: () => boolean): Promise<boolean> {
        return new Promise((resolve) => {
            let waited = 0
            const check = (): void => {
                if (abandoned()) { resolve(false); return }
                if (!hold.isInFlight() && pin === null) { resolve(true); return }
                waited += 1
                if (waited > HOLD_WAIT_FRAMES) { resolve(false); return }
                requestFrame(check)
            }
            requestFrame(check)
        })
    }

    function readPosition(): void {
        if (!host) return
        const distance = distanceFromEnd(host)
        atBottom = isAtBottom(distance, win.slid)
        farFromLatest = isFar(distance, host.clientHeight, win.slid)
        if (atBottom) { replyUnread = false; newCount = 0 }
    }

    export async function jumpToLatest({ animate, focusNewest }: { animate: boolean, focusNewest: boolean }): Promise<void> {
        if (installed && chatSurface.hidden) return
        // Rebuilding a slid window unmounts rows, which an open editor forbids; the new-message button stays until the editor closes.
        if (win.slid && hasMessageEditorDrafts()) return
        const mine = ++jumpGeneration
        travel.cancel()
        traveling = false
        const forRoom = room()
        // Taken now, so the reader's input between the tap and the first write ends the jump.
        const intentAtStart = intentSeq
        const abandoned = (): boolean => destroyed || mine !== jumpGeneration || room() !== forRoom || intentSeq !== intentAtStart || (installed && chatSurface.hidden)
        if (hold.isInFlight() || pin !== null) {
            if (!await waitForHold(abandoned)) return
            if (win.slid && hasMessageEditorDrafts()) return
        }
        if (abandoned() || !host) return
        const scroller = host
        realign.cancel()
        if (win.slid) rebuildNewestWindow()
        const plan = travelPlan({ distance: distanceFromEnd(scroller), viewport: scroller.clientHeight, reduced: !animate })
        if (plan.cutTo !== null) scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight - plan.cutTo)
        const land = (): void => {
            traveling = false
            readPosition()
            follower?.sync()
            follower?.follow()
            if (!focusNewest) return
            // The newest row is the first article in document order; the focus scroll is suppressed so it cannot move the landing.
            const newest = rows?.querySelector<HTMLElement>('article[data-part="chat-message"]')
            if (newest) asShellFocus(() => newest.focus({ preventScroll: true }))
        }
        if (plan.duration === 0) {
            scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
            land()
            return
        }
        traveling = true
        travelStops = () => abandoned() || hold.isInFlight()
        travel.run(plan.duration, (completed) => {
            if (completed) land()
            else if (mine === jumpGeneration) { traveling = false; readPosition() }
        })
    }

    // Brings message `index` (-1 is the first message) to the upper third of the visible area, focuses it and holds it against late layout.
    // The answer says whether it ran: a hidden surface defers (and replays when shown), an editor that forbids the window change blocks,
    // and a request that a newer jump, reader input, a chat switch or a long step hold overtook is cancelled.
    export function jumpTo(index: number, { align = 'third', recordOrigin = true }: JumpOptions = {}): Promise<JumpResult> {
        settlePendingJump('cancelled')
        const generation = ++jumpGeneration
        travel.cancel()
        traveling = false
        return new Promise((resolve) => {
            const deferred = installed && chatSurface.hidden
            if (deferred) resolve({ status: 'deferred', from: null, to: index })
            pendingJump = { index, align, recordOrigin, generation, forRoom: room(), intentAtStart: intentSeq, settle: deferred ? null : resolve }
            jumpRequestToken += 1
        })
    }

    // Goes back to where a jump started. A reader who was following the newest message lands at the newest message again;
    // otherwise the message that was at the top of the screen returns to the same distance from the top edge. The index is clamped to the chat.
    export async function returnTo(origin: JumpOrigin): Promise<JumpResult> {
        if (origin.atBottom) {
            const to = messages.length - 1
            if (installed && chatSurface.hidden) return { status: 'deferred', from: null, to }
            if (win.slid && hasMessageEditorDrafts()) return { status: 'blocked', from: null, to }
            await jumpToLatest({ animate: false, focusNewest: true })
            return { status: atBottom ? 'done' : 'cancelled', from: null, to }
        }
        return jumpTo(Math.max(-1, Math.min(origin.index, messages.length - 1)), { align: { offset: origin.offset }, recordOrigin: false })
    }

    async function runJump(request: PendingJump): Promise<void> {
        const result = await performJump(request).catch((error: unknown): JumpResult => {
            recordCaughtError('chat.jump', error)
            return { status: 'cancelled', from: null, to: request.index }
        })
        request.settle?.(result)
    }

    function captureOrigin(scroller: HTMLElement): JumpOrigin | null {
        const top = rows ? viewportTopRow(scroller, rows) : null
        const article = top?.querySelector<HTMLElement>('article[data-chat-index]')
        if (!top || !article) return null
        return { index: Number(article.dataset.chatIndex), offset: top.getBoundingClientRect().top - scroller.getBoundingClientRect().top, atBottom: isAtBottom(distanceFromEnd(scroller), win.slid) }
    }

    async function performJump(request: PendingJump): Promise<JumpResult> {
        const { index, align, recordOrigin, generation, forRoom, intentAtStart } = request
        const outcome = (status: JumpStatus, from: JumpOrigin | null = null): JumpResult => ({ status, from, to: index })
        const abandoned = (): boolean => destroyed || generation !== jumpGeneration || room() !== forRoom || intentSeq !== intentAtStart || (installed && chatSurface.hidden)
        // A request overtaken before it ran (a chat switch changes the length it is judged against) is cancelled, not out of range.
        if (abandoned()) return outcome('cancelled')
        if (index < -1 || index > messages.length - 1 || (index === -1 && character.type !== 'character')) return outcome('outOfRange')
        // A step hold owns the position until it settles, so nothing is read, rebuilt or written under its pin.
        if ((hold.isInFlight() || pin !== null) && !await waitForHold(abandoned)) return outcome('cancelled')
        if (abandoned() || !host) return outcome('cancelled')
        const scroller = host
        realign.cancel()
        const from = recordOrigin ? captureOrigin(scroller) : null
        // A target far from the newest message slides the window around it. While an editor is open nothing unmounts,
        // so a window the jump would slide stays where it is and only a target that is already mounted can be reached.
        const folded = chatFoldedStateMessageIndex.index >= 0
        const jumped = jumpWindow(index, messages.length, loadPages, CAP)
        if (!hasMessageEditorDrafts() || jumpOnlyGrows(win.slid, folded, jumped, loadPages)) {
            loadPages = jumped.pages
            if (!folded) bottom = jumped.bottom
        }
        await afterFlush()
        if ((hold.isInFlight() || pin !== null) && !await waitForHold(abandoned)) return outcome('cancelled')
        if (abandoned() || !rows) return outcome('cancelled')
        const article = rows.querySelector<HTMLElement>(`article[data-chat-index="${index}"]`)
        if (!article) return outcome(hasMessageEditorDrafts() ? 'blocked' : 'outOfRange')
        const container = article.closest<HTMLElement>('[data-part="chat-message-container"], [data-part="chat-first-message"]') ?? article
        const hostTop = scroller.getBoundingClientRect().top
        const targetTop = container.getBoundingClientRect().top
        scroller.scrollTop += align === 'third'
            ? alignDelta({ targetTop, hostTop, clientHeight: scroller.clientHeight, topInset: parseInset(getComputedStyle(scroller).scrollPaddingTop) })
            : targetTop - hostTop - align.offset
        // The jump left the newest message on purpose; arriving at the bottom re-enters following. Focus comes after the write and without
        // a focus scroll, so it cannot undo the alignment, and the hold starts last so it captures the written position.
        follower?.release()
        follower?.sync()
        asShellFocus(() => article.focus({ preventScroll: true }))
        realign.start({ row: container, ms: JUMP_HOLD_MS })
        readPosition()
        return outcome('done', from)
    }

    export function anchorNewestBottom() {
        if (installed && chatSurface.hidden) return
        // The keyboard anchors the newest message to the bottom; with it unmounted there is nothing to anchor.
        if (win.slid) return
        realign.cancel()
        rows?.firstElementChild?.scrollIntoView({ behavior: 'instant', block: 'end' })
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
        }
        replyUnread = false
        newCount = 0
        atBottom = true
        farFromLatest = false
        follower?.sync()
        follower?.follow()
        return host.scrollTop
    }
    function restAtNewest(forRoom: string | null): void {
        // This pass signals only the hold that was pending when it was asked for; a newer key change owns a newer hold.
        const forHold = openWarmHold
        void afterFlush().then(() => {
            if (destroyed || room() !== forRoom) return
            const placed = placeAtNewest()
            if (placed === null || typeof requestAnimationFrame === 'undefined') { releaseOpenWarmHold(forHold); return }
            requestAnimationFrame(() => {
                if (destroyed || room() !== forRoom) return
                if (host && host.scrollTop === placed) placeAtNewest()
                releaseOpenWarmHold(forHold)
            })
        })
    }

    // Older rows mount above the reader: the distance from the bottom is restored explicitly, not left to CSS scroll anchoring.
    let pendingBottomDistance: number | null = null
    // Mounted rows that lie wholly below or above the viewport; the window can unmount them without the reader seeing it.
    // Classified on the row containers, so a skipped (content-visibility) older row is not laid out to be measured.
    function offscreenCounts(scroller: HTMLElement): { newer: number, older: number } {
        return offscreenRowCounts(scroller, rows)
    }
    // The height the newest `count` mounted rows (from `start` down) take in the scroll content, measured on their containers.
    function heightOfNewest(start: number, count: number): number {
        let sum = 0
        for (const row of rows?.querySelectorAll<HTMLElement>('article[data-part="chat-message"]') ?? []) {
            if (Number(row.dataset.chatIndex) <= start - count) continue
            const box = row.closest<HTMLElement>('[data-part="chat-message-container"]') ?? row
            sum += box.getBoundingClientRect().height
        }
        return sum
    }
    function loadOlder(): void {
        if (!host || pendingBottomDistance !== null || newerPending || hold.isInFlight()) return
        const current = host
        const folded = chatFoldedStateMessageIndex.index >= 0
        const start = win.start
        // A window slides only off the newest end; under a fold the first row is the fold target and stays.
        const slide = slideOlder({ bottom, pages: loadPages }, { start, length: messages.length, additional: shellPages(getAdditionalChatLoadPages(DBState.db), CAP), cap: CAP, offscreenNewer: folded ? 0 : offscreenCounts(current).newer, editorsOpen: hasMessageEditorDrafts() })
        // At the cap with nothing to unmount (an editor is open) the window stays as it is.
        if (slide.pages === loadPages && slide.trimmedNewer === 0) return
        // The unmounted newest rows leave the scroll content below the reader, so the restored distance from the bottom shrinks by their height.
        pendingBottomDistance = current.scrollHeight - current.scrollTop - (slide.trimmedNewer > 0 ? heightOfNewest(start, slide.trimmedNewer) : 0)
        loadPages = slide.pages
        if (!folded) bottom = slide.bottom
        const restore = () => {
            const target = Math.max(0, current.scrollHeight - (pendingBottomDistance ?? 0))
            // A step that started after the rows mounted owns the position: a restore from the old bottom distance would undo its correction.
            // The browser stores the scroll position at float precision, so a written target reads back within WRITE_EPSILON, not equal to it.
            const wrote = !hold.isInFlight() && Math.abs(current.scrollTop - target) > WRITE_EPSILON
            if (wrote) current.scrollTop = target
            follower?.sync()
            return { target, wrote }
        }
        void afterFlush().then(() => {
            if (destroyed) { pendingBottomDistance = null; return }
            const { target: placed } = restore()
            if (typeof requestAnimationFrame === 'undefined') { pendingBottomDistance = null; realign.start(); return }
            // The second pass is queued before the window's frame check, so it runs first in the next frame. A correction the window
            // makes lands exactly on the first pass's position, and a second pass that ran after it would restore the old bottom distance over it.
            requestAnimationFrame(() => {
                // A second pass that moved the position starts a new window there, so the window never pulls back to the first pass's position.
                if (!destroyed && Math.abs(current.scrollTop - placed) <= WRITE_EPSILON && restore().wrote) realign.start()
                pendingBottomDistance = null
            })
            realign.start()
        })
    }

    // Reading forward in a slid window: newer rows mount below and the oldest off-screen rows unmount. The viewport-top row's offset is
    // held (the unmounted rows sit above it), by a correction after the rows render and once more in the next frame; a reader's
    // input since the slide ends the corrections, so they never write against the reader.
    let newerPending = false
    function loadNewer(): void {
        if (!host || !rows || !win.slid || newerPending || pendingBottomDistance !== null || hold.isInFlight()) return
        const current = host
        if (current.scrollHeight - current.scrollTop - current.clientHeight > 100) return
        realign.cancel()
        const held = viewportTopRow(current, rows)
        if (!held) return
        const start = win.start
        const slide = slideNewer({ bottom, pages: loadPages }, { start, length: messages.length, additional: shellPages(getAdditionalChatLoadPages(DBState.db), CAP), cap: CAP, offscreenOlder: offscreenCounts(current).older, editorsOpen: hasMessageEditorDrafts() })
        // At the cap with nothing to unmount (an editor is open) the window stays as it is.
        if (slide.pages === loadPages && slide.bottom === bottom) return
        const offset = held.getBoundingClientRect().top - current.getBoundingClientRect().top
        const seen = intentSeq
        newerPending = true
        loadPages = slide.pages
        bottom = slide.bottom
        const correct = () => {
            if (!held.isConnected || intentSeq !== seen || hold.isInFlight()) return
            const delta = held.getBoundingClientRect().top - current.getBoundingClientRect().top - offset
            if (Math.abs(delta) > WRITE_EPSILON) current.scrollTop += delta
            follower?.sync()
        }
        void afterFlush().then(() => {
            if (destroyed) { newerPending = false; return }
            correct()
            if (typeof requestAnimationFrame === 'undefined') { newerPending = false; return }
            requestAnimationFrame(() => {
                if (!destroyed) correct()
                newerPending = false
            })
        })
    }

    export function onScroll() {
        if (!host || (installed && chatSurface.hidden)) return
        follower?.sync()
        // The travel to the newest message owns the position: older and newer rows are not loaded under it.
        if (!traveling) {
            if (host.scrollTop < 100 && win.hasOlder) loadOlder()
            else loadNewer()
        }
        readPosition()
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
                        guiRevision={guiPointer + (rowPointers[row.idx] ?? 0)} stepRow={runStep} {onBranch} {getTreeView} {getBusy} {onReroll} {unReroll} {onOpenActions} {onCloseActions} {onOpenCustomize} onOverlay={(open) => setOverlay(row.key, open)} />
                    {#snippet failed(_error, reset)}
                        <div data-part="chat-message-failed" role="note">{row.message.data}<p>{language.messageRenderFailed}</p><button onclick={reset}>{language.messageRenderRetry}</button></div>
                    {/snippet}
                </svelte:boundary>
            </div>
        {/each}
        {#if chat && win.firstMounted && character.type === 'character'}
            <div data-part="chat-first-message">
                <svelte:boundary onerror={(error) => recordCaughtError('chat.message', error)}>
                    <ShellMessage idx={-1} message={{ role: 'char', data: firstMessageOf(character, chat) }} name={character.name} img={character.image} character={createSimpleCharacter(character)} firstMessage getTreeView={firstMessageTreeView} neighbourText={(index) => chat ? firstMessageOf(character, { fmIndex: index - 2 }) : null} onReroll={() => stepFirstMessage(1)} unReroll={() => stepFirstMessage(-1)} stepRow={runStep} {onOpenActions} {onCloseActions} {onOpenCustomize} />
                    {#snippet failed(_error, reset)}<div role="note">{language.messageRenderFailed}<button onclick={reset}>{language.messageRenderRetry}</button></div>{/snippet}
                </svelte:boundary>
            </div>
        {/if}
    {/key}
    {#if chatFoldedStateMessageIndex.index !== -1}
        <button data-part="chat-load-more" onclick={() => { loadPages = foldLoadMorePages(loadPages, chatFoldedStateMessageIndex.index, CAP, hasMessageEditorDrafts()); chatFoldedState.data = null }}>{language.loadMore}</button>
    {/if}
</div>

<style>
    [data-part="chat-message-container"].older { content-visibility: auto; contain-intrinsic-size: auto var(--size-39); }
</style>
