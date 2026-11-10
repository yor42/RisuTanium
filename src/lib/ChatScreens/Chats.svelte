<script lang="ts">
    import type { character, groupChat, Message, StreamingDisplayOptimizationMode } from 'src/ts/storage/database.svelte';
    import { mount, onDestroy, unmount, untrack } from 'svelte';
    import ChatMessageBoundary from './ChatMessageBoundary.svelte';
    import { useCharImageLookups } from 'src/ts/media/charImageLookups';
    import { createSimpleCharacter, DBState, selectedCharID, ReloadChatPointer } from 'src/ts/stores.svelte';
    import { chatFoldedStateMessageIndex } from 'src/ts/globalApi.svelte';
    import { get } from 'svelte/store';
    import { isActiveStreamReply } from 'src/ts/process/activeStreams';
    import { createMountHolders, type MountHolderRun } from './chatMountHolders';
    import { treeView } from 'src/ts/process/chatTreeView';
    import { chatSurface, isChatSurfaceInstalled, onSurfaceHiding } from './chatSurface.svelte';
    import { scopeOf } from './chatBodyRenderCache';
    import { holdWarmAsks } from './deferredAssetImages';

    const getCurrentChatRoomId = () => {
        const charId = get(selectedCharID);
        if (charId < 0) return null;
        const char = DBState.db.characters[charId];
        if (!char) return null;
        return char.chats?.[char.chatPage]?.id ?? null;
    };

    let {
        messages,
        currentCharacter,
        onReroll,
        unReroll,
        currentUsername,
        userIcon,
        loadPages,
        windowResetToken = 0,
        userIconPortrait,
        hasNewUnreadMessage = $bindable(false),
        onStep = undefined,
        onBranch = undefined,
        getBusy = undefined
    }:{
        messages: Message[]
        currentCharacter: character|groupChat
        onReroll: () => void
        unReroll: () => void
        currentUsername: string
        userIcon: string
        loadPages: number
        windowResetToken?: number
        userIconPortrait?: boolean
        hasNewUnreadMessage?: boolean
        onStep?: (index: number, expectedId: string | undefined, direction: 'back' | 'forward') => void
        onBranch?: (index: number, expectedId: string | undefined) => void
        getBusy?: () => boolean
    } = $props();

    // One sibling view per chat, rebuilt when the path ids or `alt` change. Rows read it through
    // `getTreeView` at render time, so no tree data enters the row hash and no row remounts for it.
    const chatTreeView = $derived.by(() => {
        const chat = currentCharacter.chats?.[currentCharacter.chatPage];
        return chat ? treeView(chat) : null;
    });
    const getTreeView = () => chatTreeView;

    // Stage A (A-lite) of the chat-list-window plan: bumped by
    // DefaultChatScreen only when a chat-window reset lowered loadPages.
    // Not reactive state -- it's plain instance-local bookkeeping,
    // read and written only from inside the $effect below. Initialized from
    // the prop's value at component creation, so a freshly mounted Chats
    // (e.g. after a cold-storage switch destroys the old one) never replays a
    // stale scroll for a token bump it wasn't present for.
    let lastHandledResetToken = untrack(() => windowResetToken);

    // Without an installed surface this list behaves as it always did. With one, the rows are surface rows, the
    // effect below does no row work while Settings covers the chat, and a rebuild return replaces every row.
    const surfaceInstalled = isChatSurfaceInstalled();
    let lastRebuildEpoch = surfaceInstalled ? untrack(() => chatSurface.rebuildEpoch) : 0;

    let chatBody: HTMLDivElement;

    // The character and user icons are read through holds that last as long as this list.
    const lookups = useCharImageLookups();

    // The same identity the render cache scopes a chat by; null when no chat is selected.
    const ownerKey = (): string | null => {
        const charId = get(selectedCharID);
        if (charId < 0) return null;
        const char = DBState.db.characters[charId];
        if (!char) return null;
        return scopeOf(char.chaId, char.chats?.[char.chatPage]?.id, char.chatPage);
    };

    // The list's position and owner as Settings hid the chat, while it was still laid out. The first visible run after
    // the hide takes and clears it; a rebuild return restores only this value, and only for the same owner, because
    // anything read later sees rows the release flush has already changed.
    let hideCapture: { top: number, owner: string | null } | null = null;
    if(surfaceInstalled){
        const stopCapturing = onSurfaceHiding(() => {
            const host = chatBody?.parentElement ?? null;
            hideCapture = host ? { top: host.scrollTop, owner: ownerKey() } : null;
        });
        onDestroy(stopCapturing);
    }

    let hashes: Set<number> = new Set();
    // The inputs of each row's hash as of the previous run, by row index. A row whose inputs are all unchanged reuses its
    // hash instead of walking its text again, so a streamed chunk costs a walk of the changed row only. `msg` is the
    // message object the entry was made for, and `streamCarry` marks a hash that the streaming tail carries in place
    // while its text changes: such an entry is never reused as a plain memo hit.
    type HashMemoEntry = { data: string, id: string, tail: string, hash: number, streamCarry: boolean, msg: Message };
    let hashMemo: Map<number, HashMemoEntry> = new Map();
    type ChatInstance = {
        updateStreamingDisplay?: (state: {
            isOptimizedStreamingMessage: boolean
            streamingOptimizationMode: StreamingDisplayOptimizationMode
            rawStreamingText: string
            message?: string
            translationHold?: boolean
        }) => void
        isTranslatedView?: () => boolean
        updateExpectedId?: (id: string | undefined) => void
    }
    let mountInstances: Map<number, ChatInstance> = new Map();
    // Every run of the effect below that mounts anything mounts all of its roots under one holder, so
    // each run adds at most one child effect to the effect and the roots of a run stay children of one parent.
    const mountHolders = createMountHolders<number>();

    //Non-cryptographic hash function to generate a unique hash for each message
    function hashCode(str:string):number {
        let hash = 0;
        for (let i = 0, len = str.length; i < len; i++) {
            let chr = str.charCodeAt(i);
            hash = (hash << 5) - hash + chr;
            hash |= 0; // Convert to 32bit integer
        }
        if(hash == 0){
            hash = 1; // Ensure hash is not zero
        }
        return hash;
    }

    const updateChatBody = () => {
        if(!chatBody){
            return
        }

        let nextHash = 0;
        let currentHashes: Set<number> = new Set();
        // Both slots are asked on every run, so a changed image replaces the old hold and kept rows follow to the new one.
        const charImage = lookups.get('char', currentCharacter.image, 'css')
        const userImage = lookups.get('user', userIcon, 'css')
        const simpleChar = createSimpleCharacter(currentCharacter);
        let loadStart = messages.length - 1
        let loadEnd = messages.length - loadPages
        const currentChat = currentCharacter.chats?.[currentCharacter.chatPage]
        const configuredPerformanceMode = DBState.db.streamingDisplayOptimizationMode ?? 'off';
        const performanceMode = currentChat?.isStreaming
            ? currentChat.activeStreamingDisplayOptimizationMode ?? configuredPerformanceMode
            : configuredPerformanceMode
        const activeStreamingIndex = performanceMode !== 'off' && currentChat?.isStreaming
            ? messages.length - 1
            : -1

        if(chatFoldedStateMessageIndex.index !== -1){
            loadStart = chatFoldedStateMessageIndex.index
            loadEnd = Math.max(0, chatFoldedStateMessageIndex.index - loadPages)
        }

        const nextHashMemo: Map<number, HashMemoEntry> = new Map();
        const reloadPointerMap = get(ReloadChatPointer);
        // The loop keeps every reactive read; mounting is deferred to one holder after it, in the same order.
        const pendingMounts: Array<(run: MountHolderRun<number>) => void> = [];

        for(let i=loadStart ; i >= loadEnd; i--){
            if(i < 0) break; // Prevent out of bounds
            const message = messages[i];
            const messageLargePortrait = message.role === 'user' ? (userIconPortrait ?? false) : ((currentCharacter as character).largePortrait ?? false);
            const reloadPointer = reloadPointerMap[i] ?? 0;
            const activeStreamingMessage = i === activeStreamingIndex && message.role === 'char';
            const hashMessageData = activeStreamingMessage ? '' : message.data;
            // Read here, where the effect already re-runs on the chat's `isStreaming`
            // writes, which happen in the same step as the registry changes. The
            // note is part of the hash, so removing the flag without touching the
            // text still re-mounts the message.
            const interrupted = message.interrupted === true && !isActiveStreamReply(message.chatId);
            // Only the registered reply at the last index defers its auto-translation. The same boolean is part of the
            // hash and a mount-time prop, so an instance that defers is replaced when the stream ends. `autoTranslate`
            // is read only for that row while it streams, so nothing else gains a dependency.
            const deferAutoTranslate = currentChat?.isStreaming === true
                && i === messages.length - 1
                && isActiveStreamReply(message.chatId)
                && DBState.db.autoTranslate === true;
            const rowId = message.chatId ?? '';
            const rowTail = i.toString() + messageLargePortrait.toString() + message.disabled?.toString() + reloadPointer.toString() + (interrupted ? 'interrupted' : '') + (deferAutoTranslate ? 'autotr' : '');
            const memoEntry = hashMemo.get(i);
            // The reply being streamed in 'off' mode: the last 'char' row of a streaming chat. Its row is carried in place
            // while only its text changes, and the translated view waits for the reply to end.
            const offTail = performanceMode === 'off'
                && currentChat?.isStreaming === true
                && i === messages.length - 1
                && message.role === 'char';
            const holdTail = offTail && isActiveStreamReply(message.chatId);
            // A row whose only change is a newly stamped id keeps its mounted instance and receives the id in place. It
            // holds for the same message object only: another object at this index (a switched chat or a shifted row)
            // replaces the row, and a carried tail is never kept here, so a stream still ends with one remount.
            const stampKept = memoEntry !== undefined
                && !memoEntry.streamCarry
                && memoEntry.msg === message
                && memoEntry.id === ''
                && rowId !== ''
                && memoEntry.data === hashMessageData
                && memoEntry.tail === rowTail;
            let currentHash: number;
            let streamCarry = false;
            if(stampKept){
                currentHash = memoEntry.hash;
            }
            else if(offTail && memoEntry && memoEntry.msg === message && memoEntry.id === rowId && memoEntry.tail === rowTail){
                currentHash = memoEntry.hash;
                streamCarry = true;
            }
            else if(memoEntry && !memoEntry.streamCarry && memoEntry.data === hashMessageData && memoEntry.id === rowId && memoEntry.tail === rowTail){
                currentHash = memoEntry.hash;
            }
            else{
                currentHash = hashCode(hashMessageData + rowId + rowTail);
            }
            nextHashMemo.set(i, { data: hashMessageData, id: rowId, tail: rowTail, hash: currentHash, streamCarry, msg: message });
            currentHashes.add(currentHash);
            if(!hashes.has(currentHash)){
                const b = document.createElement('div');
                b.setAttribute('x-hashed', currentHash.toString());
                b.classList.add('chat-message-container');
                // A tail mounted at the end of a carried stream keeps the translated view the carried instance showed.
                // Read here, before the removal below unmounts that instance.
                const startTranslated = !offTail
                    && memoEntry?.streamCarry === true
                    && memoEntry.msg === message
                    && mountInstances.get(memoEntry.hash)?.isTranslatedView?.() === true;
                const props = {
                    message: message.data,
                    isLastMemory: false,
                    idx: i,
                    totalLength: messages.length,
                    img: message.role === 'user' ? userImage : charImage,
                    onReroll: onReroll,
                    unReroll: unReroll,
                    rerollIcon: 'dynamic' as const,
                    character: simpleChar,
                    largePortrait: messageLargePortrait,
                    messageGenerationInfo: message.generationInfo,
                    role: message.role,
                    name: message.role === 'user' ? currentUsername : currentCharacter.name,
                    isComment: message.isComment ?? false,
                    disabled: message.disabled ?? false,
                    isOptimizedStreamingMessage: activeStreamingMessage,
                    streamingOptimizationMode: performanceMode,
                    rawStreamingText: message.data,
                    interrupted,
                    deferAutoTranslate,
                    translationHold: holdTail,
                    startTranslated,
                    expectedId: message.chatId,
                    onStep: onStep,
                    onBranch: onBranch,
                    getTreeView: getTreeView,
                    getBusy: getBusy,
                    surface: true,
                }
                const previousHash = nextHash;
                pendingMounts.push((run) => {
                    const inst = mount(ChatMessageBoundary, { target: b, props })
                    run.add(currentHash);
                    mountInstances.set(currentHash, inst);
                    const nextElement = previousHash === 0 ? null : chatBody.querySelector(`[x-hashed="${previousHash}"]`);
                    if(nextElement){
                        chatBody.insertBefore(b, nextElement?.nextSibling);
                    }
                    else{
                        chatBody.prepend(b);
                    }
                })
            }
            else{
                mountInstances.get(currentHash)?.updateStreamingDisplay?.({
                    isOptimizedStreamingMessage: activeStreamingMessage,
                    streamingOptimizationMode: performanceMode,
                    rawStreamingText: message.data,
                    message: offTail ? message.data : undefined,
                    translationHold: holdTail,
                })
                if(stampKept){
                    mountInstances.get(currentHash)?.updateExpectedId?.(message.chatId)
                }
            }
            nextHash = currentHash;
            
        }

        if(pendingMounts.length > 0){
            const run = mountHolders.begin();
            try{
                // Untracked: nothing the mounted components read may become a dependency of the Chats effect.
                run.attach($effect.root(() => untrack(() => {
                    for(const mountOne of pendingMounts){
                        mountOne(run);
                    }
                })));
            }
            finally{
                run.finish();
            }
        }

        //@ts-expect-error Set<T> requires type arg, and Set.difference needs 'esnext' lib (polyfilled by Core-js)
        const toRemove:Set = hashes.difference(currentHashes);
        toRemove.forEach((hash) => {
            const inst = mountInstances.get(hash);
            if(inst){
                unmount(inst);
                mountInstances.delete(hash);
            }
            mountHolders.release(hash);
            const element = chatBody.querySelector(`[x-hashed="${hash}"]`);
            if(element){
                chatBody.removeChild(element);
            }
        });

        hashes = currentHashes;
        hashMemo = nextHashMemo;

    };

    // The warm hold of the list that is opening (see holdWarmAsks): taken before the new rows are mounted, so their loaders wait for it.
    // Plain variables on purpose: nothing renders from them, and the effect that writes them must not depend on them.
    let openWarmHold: (() => void) | null = null;
    let openWarmFrame: number | null = null;
    const requestFrame = (callback: () => void): number => typeof requestAnimationFrame === 'function' ? requestAnimationFrame(callback) : window.setTimeout(callback, 16);
    const cancelFrame = (id: number): void => { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id); else window.clearTimeout(id); };
    function cancelOpenWarmFrame(): void {
        if(openWarmFrame !== null){
            cancelFrame(openWarmFrame);
            openWarmFrame = null;
        }
    }
    function takeOpenWarmHold(): void {
        // The pending hold keeps living through the loaders that wait on it; only its list signal is given here.
        openWarmHold?.();
        cancelOpenWarmFrame();
        openWarmHold = holdWarmAsks();
    }
    // Releases `which` and empties the slot only when `which` is still the pending hold, so a stale signal cannot end a newer one.
    function releaseOpenWarmHold(which: (() => void) | null): void {
        which?.();
        if(which !== null && openWarmHold === which){
            openWarmHold = null;
        }
    }
    // Gives the list signal of `forHold` after `frames` animation frames. A newer take cancels the pending frame, and its own
    // hold is released by its own call, so a stale frame cannot end a newer hold.
    function releaseAfterFrames(forHold: (() => void) | null, frames: number): void {
        openWarmFrame = requestFrame(() => {
            openWarmFrame = null;
            if(frames > 1){
                releaseAfterFrames(forHold, frames - 1);
            }
            else{
                releaseOpenWarmHold(forHold);
            }
        });
    }

    onDestroy(() => {
        console.log('Unmounting Chats');
        cancelOpenWarmFrame();
        releaseOpenWarmHold(openWarmHold);
        hashes.clear();
        hashMemo.clear();
        mountInstances.forEach((inst) => {
            unmount(inst);
        });
        mountInstances.clear();
        mountHolders.destroyAll();
    })

    // Drops every row so the next update mounts them all afresh from the current state.
    function unmountAllRows() {
        mountInstances.forEach((inst) => {
            unmount(inst);
        });
        mountInstances.clear();
        mountHolders.destroyAll();
        chatBody.querySelectorAll('[x-hashed]').forEach((element) => {
            element.remove();
        });
        hashes = new Set();
        hashMemo = new Map();
    }

    function checkIfAtBottom() {
        if (!chatBody || !chatBody.parentElement) return true;
        const sc = chatBody.parentElement;
        const lastEl = chatBody.firstElementChild;
        if (!lastEl) return true;
        const rect = lastEl.getBoundingClientRect();
        const scRect = sc.getBoundingClientRect();
        return rect.top <= scRect.bottom + 100;
    }

    export const scrollToLatestMessage = () => {
        if(!chatBody) return;
        hasNewUnreadMessage = false;
        const element = chatBody.firstElementChild;
        if(element){
             element.scrollIntoView({ behavior: 'instant', block: 'start' });
        }
    }

    let previousLength = 0;
    let previousChatRoomId: string | null = null;

    $effect(() => {
        console.log('Updating Chats');
        void $ReloadChatPointer; // Make $effect track ReloadChatPointer changes
        let rebuilding = false;
        let restoreTop: number | null = null;
        if(surfaceInstalled){
            // Streaming and every other update wait for the return; the release re-runs this effect once.
            if(chatSurface.hidden){
                return
            }
            rebuilding = chatSurface.rebuildEpoch !== lastRebuildEpoch;
            const capture = hideCapture;
            hideCapture = null;
            // A chat switched during the visit has no position to restore; the owner is read untracked so it adds no dependency.
            if(rebuilding && capture !== null && capture.owner === untrack(ownerKey)){
                restoreTop = capture.top;
            }
        }
        // The bottom position is read only when the auto-scroll block below will use it: a new 'char' reply in the same
        // chat. A streamed chunk grows no list, so it forces no layout here.
        const currentChatRoomId = getCurrentChatRoomId();
        const isSameChat = currentChatRoomId === previousChatRoomId;
        let newCharReply = false;
        if(isSameChat && messages.length > previousLength){
            const lastMsg = messages[messages.length - 1];
            newCharReply = !!lastMsg && lastMsg.role === 'char' && !!DBState.db.autoScrollToNewMessage;
        }
        const wasAtBottom = newCharReply ? checkIfAtBottom() : false;
        const scrollHost = chatBody?.parentElement ?? null;
        // Opening a list holds its warm images: a rebuild return (re-entry) and a room change (including the first run that
        // has a room). The take comes before any row is unmounted or mounted, so every new row's loader waits for it. A rebuild
        // gives its list signal one frame after the scroll restore, a room change two frames after the rows mount. A stream
        // chunk or an append in the same room takes nothing.
        let signalFrames = 0;
        if(rebuilding){
            takeOpenWarmHold();
            signalFrames = 1;
        }
        else if(!isSameChat && currentChatRoomId !== null){
            takeOpenWarmHold();
            signalFrames = 2;
        }
        const signalHold = signalFrames > 0 ? openWarmHold : null;
        if(rebuilding){
            lastRebuildEpoch = chatSurface.rebuildEpoch;
            unmountAllRows();
        }
        updateChatBody()
        if(restoreTop !== null && scrollHost){
            scrollHost.scrollTop = restoreTop;
        }
        if(signalHold !== null){
            releaseAfterFrames(signalHold, signalFrames);
        }

        // Scroll-to-bottom after a window reset that actually lowered
        // loadPages (Stage A, A-lite). Reading windowResetToken here makes it
        // a dependency of this effect, which is fine: it changes in the same
        // flush as loadPages, so this effect already reruns for that reset.
        // Deliberately not scrollToLatestMessage: its scrollIntoView hides a
        // tall newest message and the composer, and drifts once the async
        // ChatBody parse settles.
        if(windowResetToken !== lastHandledResetToken){
            lastHandledResetToken = windowResetToken;
            if(chatBody?.parentElement){
                chatBody.parentElement.scrollTop = 0;
            }
        }

        // Only auto-scroll if it's the same chat and new messages were added
        if(newCharReply){
            if(wasAtBottom || DBState.db.alwaysScrollToNewMessage){
                const element = chatBody.firstElementChild;
                if(element){
                    setTimeout(() => {
                        element.scrollIntoView({ behavior: 'instant', block: 'start' });
                    }, 700);
                }
            } else {
                hasNewUnreadMessage = true;
            }
        }
        previousLength = messages.length;
        previousChatRoomId = currentChatRoomId;
    })

</script>

<div class="flex flex-col-reverse" bind:this={chatBody}></div>
