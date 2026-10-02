<script lang="ts">

    import Suggestion from './Suggestion.svelte';
    import { CameraIcon, DatabaseIcon, DicesIcon, GlobeIcon, ImagePlusIcon, LanguagesIcon, Laugh, MenuIcon, MicOffIcon, PackageIcon, Plus, RefreshCcwIcon, ReplyIcon, Send, StepForwardIcon, XIcon, BrainIcon, ArrowDown, SparkleIcon } from "@lucide/svelte";
    import { selectedCharID, PlaygroundStore, createSimpleCharacter, hypaV3ModalOpen, ScrollToMessageStore, additionalChatMenu, additionalFloatingActionButtons, easyPanelStore, chatPanelStore } from "../../ts/stores.svelte";
    import { tick, onDestroy, untrack } from 'svelte';
    import Chat from "./Chat.svelte";
    import { DBState } from 'src/ts/stores.svelte';
    import { getCharImage } from "../../ts/characters";
    import { chatProcessStage, doingChat } from "../../ts/process/index.svelte";
    import { livePersona, sleep } from "../../ts/util";
    import { language } from "../../lang";
    import { alertError, alertNormal, alertWait, showHypaV2Alert } from "../../ts/alert";
    import CreatorQuote from "./CreatorQuote.svelte";
    import { stopTTS } from "src/ts/process/tts";
    import MainMenu from '../UI/MainMenu.svelte';
    import AssetInput from './AssetInput.svelte';
    import { aiLawApplies, chatFoldedState, chatFoldedStateMessageIndex, downloadFile } from 'src/ts/globalApi.svelte';
    import { v4 } from 'uuid';
    import { postChatFile } from 'src/ts/process/files/multisend';
    import { getInlayAsset } from 'src/ts/process/files/inlays';
    import { coldStorageHeader, preLoadChat, retryLegacyColdChatLoad } from 'src/ts/process/coldstorage.svelte';
    import { coldChatNoticeText, legacyRetryStateFor, legacyRetryView, matchColdStorageLoadErrorKey, type LegacyRetryState } from 'src/ts/process/coldstorageData';
    import Chats from './Chats.svelte';
    import Button from '../UI/GUI/Button.svelte';
    import PluginDefinedIcon from '../Others/PluginDefinedIcon.svelte';
    import { getAdditionalChatLoadPages, getInitialChatLoadPages } from 'src/ts/chatLoadPages';
    import { COMPOSER_DRAFT_KIND, hasMessageEditorDrafts, onDraftsChanged, registerDraft, unregisterDraft } from 'src/ts/localDrafts';
    import { chatWindowKey, createChatWindowPolicy, runWithFullWindow } from 'src/ts/chatWindowPolicy';
    import {
        send as composerSend,
        sendContinue as composerSendContinue,
        reroll as composerReroll,
        unReroll as composerUnReroll,
        runAutoMode as composerRunAutoMode,
        abortChat as composerAbortChat,
        updateInputTransateMessage as composerUpdateInputTransateMessage,
        isComposerBusy,
        isComposerLocked,
        isAutoModeActive,
        type ComposerActionsSource
    } from 'src/ts/process/composerActions.svelte';
    import { beginWork, type OriginHint } from 'src/ts/process/chatOrigin';
    import * as composerDrafts from 'src/ts/process/composerDrafts.svelte';
    import type { ComposerDraftKey, ComposerDraftRecord } from 'src/ts/process/composerDrafts.svelte';

    const loadPlaygroundMenu = () => import('../Playground/PlaygroundMenu.svelte').then(m => m.default);
    
    interface Props {
        openModuleList?: boolean;
        openChatList?: boolean;
        customStyle?: string;
    }

    let openMenu = $state(false)
    let loadPages = $state(getInitialChatLoadPages(DBState.db))
    // Stage A (A-lite) of the chat-list-window plan: bounds loadPages back to
    // its initial value on a chat-identity change, but only when no message
    // editor is open. The window-reset token below signals Chats to scroll to
    // the bottom only when a reset actually lowered the window.
    let windowResetToken = $state(0)
    const chatWindowPolicyInstance = createChatWindowPolicy({
        initial: () => getInitialChatLoadPages(DBState.db),
        editorsOpen: hasMessageEditorDrafts,
    })
    let doingChatInputTranslate = false
    let toggleStickers:boolean = $state(false)
    let showNewMessageButton = $state(false)
    let chatsInstance: any = $state()
    let isScrollingToMessage = $state(false)
    let { openModuleList = $bindable(false), openChatList = $bindable(false), customStyle = '' }: Props = $props();
    let currentCharacter = $derived(DBState.db.characters[$selectedCharID])
    let currentChatObj = $derived(currentCharacter?.chats?.[currentCharacter.chatPage])
    let currentChat = $derived(currentChatObj?.message ?? [])

    // The owner's chaId plus the on-screen chat's own id, read-only (never
    // fills a missing id -- filling is restricted to an event handler,
    // below). Null with no chat object on screen, or while either id is
    // still missing; shownDraft below falls back to the transient backstop
    // or the shared empty view in that case.
    let currentDraftKey: ComposerDraftKey | null = $derived(
        (currentCharacter?.chaId && currentChatObj?.id)
            ? { chaId: currentCharacter.chaId, chatId: currentChatObj.id }
            : null
    )

    // A transient backstop: a record bound to the on-screen chat object by
    // identity, used only while beginWork refuses to fill that chat's ids
    // (not expected to be reachable -- the on-screen chat is always read
    // through DBState, so it is always found there by identity). Never
    // stored under a key, never shown under another chat, and replaced
    // outright the moment a different chat object needs it.
    let fallbackDraftChat: unknown = $state(null)
    let fallbackDraft: ComposerDraftRecord = $state({ messageInput: '', messageInputTranslate: '', fileInput: [] })

    // Showing a chat never creates or writes its record -- this only reads.
    // Falls back to the transient record above only while it is already
    // bound to the exact chat object on screen; otherwise the shared,
    // frozen empty view.
    let shownDraft: ComposerDraftRecord = $derived(
        currentDraftKey
            ? composerDrafts.peek(currentDraftKey)
            : (currentChatObj && fallbackDraftChat === currentChatObj ? fallbackDraft : composerDrafts.EMPTY_DRAFT_VIEW)
    )

    // Protects the on-screen record from the store's own eviction. Plain
    // bookkeeping, not a record write, so this is never mistaken for a
    // write to the chat it names.
    $effect(() => {
        composerDrafts.setOnScreenKey(currentDraftKey)
    })

    /**
     * The key a write from the on-screen composer should target, filling a
     * missing chaId or chat id on the live objects first. Must only be
     * called from an event handler (a setter Svelte calls from the `input`
     * listener, an onclick, an onpaste, or the synchronous start of an
     * async handler before its first await) -- never from `$derived` or
     * `$effect`, which must not write to the live database.
     */
    function resolveDraftKeyForWrite(): ComposerDraftKey | null {
        const char = currentCharacter
        const chat = currentChatObj
        if(!char || !chat){
            return null
        }
        if(char.chaId && chat.id){
            return { chaId: char.chaId, chatId: chat.id }
        }
        const handle = beginWork(char, chat)
        if(!handle){
            return null
        }
        const key: ComposerDraftKey = { chaId: handle.origin.chaId, chatId: handle.origin.chatId }
        handle.end()
        return key
    }

    /**
     * The objects the on-screen chat is read through, for a job that goes on
     * writing to that chat after a switch. Read alongside `resolveDraftKeyForWrite`,
     * in the same synchronous stretch.
     */
    function resolveOriginHintForWrite(): OriginHint | null {
        const char = currentCharacter
        const chat = currentChatObj
        return char && chat ? { owner: char, chat } : null
    }

    /** Writes to the record named by `key`, or the transient backstop when it is null. */
    function writeDraftAt(key: ComposerDraftKey | null, update: (record: ComposerDraftRecord) => void): void {
        if(key){
            composerDrafts.write(key, update)
            return
        }
        if(fallbackDraftChat !== currentChatObj){
            fallbackDraftChat = currentChatObj
            fallbackDraft = { messageInput: '', messageInputTranslate: '', fileInput: [] }
        }
        update(fallbackDraft)
    }

    /** A synchronous, on-screen write: resolves the key fresh each call. */
    function writeDraft(update: (record: ComposerDraftRecord) => void): void {
        writeDraftAt(resolveDraftKeyForWrite(), update)
    }

    // Reads the same currentCharacter/chatPage expressions as currentChat
    // above, so the key and the messages can never diverge. This effect's
    // reactive dependencies are those underlying values -- currentCharacter,
    // its chats array, chatPage, the chat object, and its .id -- not the key
    // string itself, so the effect can re-run for reasons that leave the key
    // unchanged (e.g. a chat being added to the array). The policy only
    // resets loadPages when the resulting key string actually changes.
    // loadPages and the policy's initial-value read are wrapped in untrack,
    // so they don't add extra dependencies of their own.
    $effect.pre(() => {
        const key = chatWindowKey(currentCharacter?.chaId, currentCharacter?.chats?.[currentCharacter.chatPage])
        untrack(() => {
            const { next, lowered } = chatWindowPolicyInstance.onKey(key, loadPages)
            if(next !== loadPages){
                loadPages = next
            }
            if(lowered){
                windowResetToken += 1
            }
        })
    })

    // Applies a pending screenshot restore (Stage A, A-lite) once every
    // message editor has closed. Only a pending screenshot restore can lower
    // loadPages here -- a draft closing by itself never does, since
    // policy.onDraftsChanged() returns null unless a restore is pending.
    // This never bumps windowResetToken: going from Infinity back to the
    // pre-screenshot value only removes the oldest messages, and the scroll
    // origin is the bottom, so the view stays put; bumping here would jump
    // the user away from a message they just saved. windowResetToken is
    // bumped only by a reset in onKey that lowered the window.
    const unsubscribeDraftsChanged = onDraftsChanged(() => {
        const restored = chatWindowPolicyInstance.onDraftsChanged()
        if(restored !== null){
            loadPages = restored
        }
    })
    onDestroy(unsubscribeDraftsChanged)

    // CHORE-07 stage 7c-2: retry state for a legacy error-text chat (one
    // that hit a failed cold read before stage 7b shipped), keyed by
    // `chaId` + the recovered cold-storage key rather than the optional
    // `chat.id`, so a result never leaks onto another chat. `'pending'`
    // disables the Retry button; the other states hold the last outcome
    // until a fresh retry (or a successful one, which makes the whole notice
    // disappear since message[0] stops matching the error text) replaces it.
    // `legacyRetryStateFor` chooses the state for a result and
    // `legacyRetryView` the notice for a state.
    let coldChatRetryState: Record<string, LegacyRetryState> = $state({})

    function coldChatRetryStateKey(chaId: string, errorKey: string): string {
        return chaId + '::' + errorKey
    }

    async function retryColdChatLoad(chaId: string, errorKey: string, characterIndex: number, chatIndex: number) {
        const key = coldChatRetryStateKey(chaId, errorKey)
        coldChatRetryState[key] = 'pending'
        try {
            const result = await retryLegacyColdChatLoad(characterIndex, chatIndex)
            const state = legacyRetryStateFor(result)
            if (state) {
                coldChatRetryState[key] = state
            }
            else {
                delete coldChatRetryState[key]
            }
        }
        catch (error) {
            // retryLegacyColdChatLoad is not expected to throw (it catches
            // its own side-field merge failures internally), but a throw
            // here must never leave the button disabled forever on
            // 'pending', nor raise an unhandled rejection.
            console.error('Cold storage retry failed unexpectedly:', error)
            coldChatRetryState[key] = 'retryFailed'
        }
    }

    // Registers while the record on screen (not any other stored record) is
    // non-empty, driven from `$effect` tracking `shownDraft`'s own fields so
    // every exit path is covered -- its `messageInput`,
    // `messageInputTranslate` and `fileInput` are a single combined draft
    // here (unsent message text -- in either its normal or
    // auto-translate-input form -- and/or a staged attachment).
    const composerDraftKey = v4();
    $effect(() => {
        if (shownDraft.messageInput !== '' || shownDraft.messageInputTranslate !== '' || shownDraft.fileInput.length > 0) {
            registerDraft(composerDraftKey, COMPOSER_DRAFT_KIND);
            return () => unregisterDraft(composerDraftKey);
        }
    });
    onDestroy(() => {
        // Backstop alongside the `$effect` cleanup above -- `unregisterDraft` is a
        // safe no-op if the key was already removed.
        unregisterDraft(composerDraftKey);
    });

    function scrollToBottom() {
        chatsInstance?.scrollToLatestMessage();
    }
    $effect(() => {
        if(ScrollToMessageStore.value !== -1){
            const index = ScrollToMessageStore.value
            ScrollToMessageStore.value = -1
            scrollToMessage(index)
        }
    })

    async function scrollToMessage(index: number){
        // Forces the loading of past messages not rendered on the screen
        isScrollingToMessage = true
        try {
            const totalMessages = currentChat.length
            const neededLoadPages = totalMessages - index + 5

            if(loadPages < neededLoadPages){
                loadPages = neededLoadPages
                await tick()
            }

            let element: Element | null = null;
            // Poll for element existence (max 5 seconds)
            for(let i = 0; i < 50; i++){
                element = document.querySelector(`[data-chat-index="${index}"]`)
                if(element) break;
                await sleep(100)
            }

            const preIndex = Math.max(0, index - 3)
            const preElement = document.querySelector(`[data-chat-index="${preIndex}"]`)
            if(preElement){
                preElement.scrollIntoView({behavior: "instant", block: "start"})
            } else {
                element?.scrollIntoView({behavior: "instant", block: "start"})
            }
            await sleep(50)

            if(element){
                // Wait for images to load to prevent layout shift
                const chatContainer = document.querySelector('.default-chat-screen');
                if(chatContainer) {
                    const images = Array.from(chatContainer.querySelectorAll('img'));
                    const promises = images.map(img => {
                        if (img.complete) return Promise.resolve();
                        return new Promise(resolve => {
                            img.onload = () => resolve(null);
                            img.onerror = () => resolve(null);
                        });
                    });
                    // Wait for all images or timeout after 4 seconds
                    await Promise.race([
                        Promise.all(promises),
                        sleep(4000)
                    ]);
                }

                element.scrollIntoView({behavior: "instant", block: "start"})
                
                // Small delay and scroll again to ensure position is correct after any final layout adjustments
                await sleep(50)
                element.scrollIntoView({behavior: "instant", block: "start"})

                element.classList.add('ring-2', 'ring-blue-500')
                setTimeout(() => {
                    element.classList.remove('ring-2', 'ring-blue-500')
                }, 2000)
            }
        } finally {
            isScrollingToMessage = false
        }
    }

    // The live view of this component's own composer state that
    // src/ts/process/composerActions.svelte.ts reads and writes through: the
    // menu-close hook. The three text/file values are reached by key through
    // composerDrafts.svelte.ts, the reroll histories are per chat in
    // rerollHistory.ts, and auto mode's running state and the current
    // generation's abort controller are composerActions' own state, so none
    // of them live here.
    const composerSource: ComposerActionsSource = {
        closeMenu: () => { openMenu = false },
    }

    async function send(){
        return composerSend(composerSource)
    }
    async function sendContinue(){
        return composerSendContinue(composerSource)
    }
    async function reroll() {
        return composerReroll(composerSource)
    }
    async function unReroll() {
        return composerUnReroll(composerSource)
    }
    function abortChat(){
        composerAbortChat()
    }
    async function runAutoMode() {
        return composerRunAutoMode(composerSource)
    }

    let { userIconPortrait, currentUsername, userIcon } = $derived.by(() => {
        const bindedPersona = DBState?.db?.characters?.[$selectedCharID]?.chats?.[DBState?.db?.characters?.[$selectedCharID]?.chatPage]?.bindedPersona

        if(bindedPersona){
            const persona = livePersona(DBState.db.personas.find((p) => p.id === bindedPersona))
            if(persona){
                return {
                    currentUsername: persona.name,
                    userIconPortrait: persona.largePortrait,
                    userIcon: persona.icon
                }
            }
        }

        const selectedPersonaIndex = DBState.db.selectedPersona
        return {
            currentUsername: DBState.db.username,
            userIconPortrait: DBState.db.personas[selectedPersonaIndex].largePortrait,
            userIcon: DBState.db.personas[selectedPersonaIndex].icon
        }
    })

    let inputHeight = $state("44px")
    let inputEle:HTMLTextAreaElement = $state()
    let inputTranslateHeight = $state("44px")
    let inputTranslateEle:HTMLTextAreaElement = $state()

    function updateInputSizeAll() {
        updateInputSize()
        updateInputTranslateSize()
    }

    function updateInputTranslateSize() {
        if(inputTranslateEle) {
            inputTranslateEle.style.height = "0";
            inputTranslateHeight = (inputTranslateEle.scrollHeight) + "px";
            inputTranslateEle.style.height = inputTranslateHeight
        }
    }
    function updateInputSize() {
        if(inputEle){
            inputEle.style.height = "0";
            inputHeight = (inputEle.scrollHeight) + "px";
            inputEle.style.height = inputHeight
        }
    }

    // Both textareas are sized to the shown record's text after any write
    // by anyone (typing, a put-back, a late result, a clear) and after a
    // record change or a remount -- no writer resizes an instance
    // itself, since the instance that started an operation may be gone by
    // the time it resolves. A plain `$effect`, not `$effect.pre`: `.pre`
    // would run before Svelte applies the bound value to the textarea's DOM
    // value, and so would measure the old text's scrollHeight.
    $effect(() => {
        void shownDraft.messageInput
        void shownDraft.messageInputTranslate
        updateInputSizeAll()
    });

    async function updateInputTransateMessage(reverse: boolean) {
        const key = resolveDraftKeyForWrite()
        if(!key){
            return
        }
        return composerUpdateInputTransateMessage(key, reverse)
    }

    async function screenShot(){
        try {
            await runWithFullWindow(chatWindowPolicyInstance, () => loadPages, (v) => { loadPages = v }, async () => {
                const html2canvas = await import('html-to-image');
                const chats = document.querySelectorAll('.default-chat-screen .risu-chat')
                alertWait("Taking screenShot...")
                let canvases:HTMLCanvasElement[] = []

                for(const chat of chats){
                    const cnv = await html2canvas.toCanvas(chat as HTMLElement)
                    alertWait("Taking screenShot... "+canvases.length+"/"+chats.length)
                    canvases.push(cnv)
                }

                canvases.reverse()

                alertWait("Merging images...")

                let mergedCanvas = document.createElement('canvas');
                mergedCanvas.width = 0;
                mergedCanvas.height = 0;
                let mergedCtx = mergedCanvas.getContext('2d');

                let totalHeight = 0;
                let maxWidth = 0;
                for(let i = 0; i < canvases.length; i++) {
                    let canvas = canvases[i];
                    totalHeight += canvas.height;
                    maxWidth = Math.max(maxWidth, canvas.width);

                    mergedCanvas.width = maxWidth;
                    mergedCanvas.height = totalHeight;
                }

                mergedCtx.fillStyle = 'var(--risu-theme-bgcolor)'
                mergedCtx.fillRect(0, 0, maxWidth, totalHeight);
                let indh = 0
                for(let i = 0; i < canvases.length; i++) {
                    let canvas = canvases[i];
                    indh += canvas.height
                    mergedCtx.drawImage(canvas, 0, indh - canvas.height);
                    canvases[i].remove();
                }

                if(mergedCanvas){
                    await downloadFile(`chat-${v4()}.png`, Buffer.from(mergedCanvas.toDataURL('png').split(',').at(-1), 'base64'))
                    mergedCanvas.remove();
                }
                alertNormal(language.screenshotSaved)
            })
        } catch (error) {
            console.error(error)
            alertError("Error while taking screenshot")
        }
    }

    
</script>



<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="w-full h-full relative" style={customStyle} onclick={() => {
    openMenu = false
}}>
    
    {#if showNewMessageButton}
        {#if (DBState.db.newMessageButtonStyle === 'bottom-center' || !DBState.db.newMessageButtonStyle)}
            <button class="absolute bottom-16 left-1/2 -translate-x-1/2 bg-blue-500 text-white px-4 py-2 rounded-full shadow-lg z-50 flex items-center gap-2 hover:bg-blue-600 transition-colors" onclick={scrollToBottom}>
                <ArrowDown size={16} />
                <span>{language.newMessage}</span>
            </button>
        {/if}

        {#if DBState.db.newMessageButtonStyle === 'bottom-right'}
            <button class="absolute bottom-20 right-4 bg-blue-500 text-white px-4 py-2 rounded-full shadow-lg z-50 flex items-center gap-2 hover:bg-blue-600 transition-colors" onclick={scrollToBottom}>
                <ArrowDown size={16} />
                <span>{language.newMessage}</span>
            </button>
        {/if}

        {#if DBState.db.newMessageButtonStyle === 'bottom-left'}
            <button class="absolute bottom-20 left-4 bg-blue-500 text-white px-4 py-2 rounded-full shadow-lg z-50 flex items-center gap-2 hover:bg-blue-600 transition-colors" onclick={scrollToBottom}>
                <ArrowDown size={16} />
                <span>{language.newMessage}</span>
            </button>
        {/if}

        {#if DBState.db.newMessageButtonStyle === 'floating-circle'}
            <button class="absolute bottom-36 right-4 bg-blue-500 text-white w-12 h-12 rounded-full shadow-lg z-50 flex items-center justify-center hover:bg-blue-600 transition-colors" onclick={scrollToBottom} title="4. 원형 (우하단)">
                <ArrowDown size={20} />
            </button>
        {/if}

        {#if DBState.db.newMessageButtonStyle === 'right-center'}
            <button class="absolute top-1/2 right-2 -translate-y-1/2 bg-blue-500 text-white px-2 py-3 rounded-l-lg shadow-lg z-50 flex flex-col items-center gap-1 hover:bg-blue-600 transition-colors" onclick={scrollToBottom}>
                <ArrowDown size={14} />
                <span class="text-xs writing-mode-vertical">{language.newMessage}</span>
            </button>
        {/if}

        {#if DBState.db.newMessageButtonStyle === 'top-bar'}
            <button class="absolute top-2 left-1/2 -translate-x-1/2 bg-blue-500 text-white px-6 py-1.5 rounded-full shadow-lg z-50 flex items-center gap-2 hover:bg-blue-600 transition-colors text-sm" onclick={scrollToBottom}>
                <ArrowDown size={14} />
                <span>{language.newMessage}</span>
            </button>
        {/if}
    {/if}
    {#if isScrollingToMessage}
        <div class="absolute inset-0 z-50 flex items-center justify-center bg-black/50 text-white text-xl font-bold backdrop-blur-sm">
            Loading...
        </div>
    {/if}
    {#if $selectedCharID < 0}
        {#if $PlaygroundStore === 0}
            <MainMenu />
        {:else}
            {#await loadPlaygroundMenu() then PlaygroundMenu}
                <PlaygroundMenu />
            {/await}
        {/if}
    {:else}
        <div class="h-full w-full flex flex-col-reverse overflow-y-auto relative default-chat-screen" onscroll={(e) => {
            //@ts-expect-error scrollHeight/clientHeight/scrollTop don't exist on EventTarget, but target is HTMLElement here
            const scrolled = (e.target.scrollHeight - e.target.clientHeight + e.target.scrollTop)
            if(scrolled < 100 && DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.length > loadPages){
                loadPages += getAdditionalChatLoadPages(DBState.db)
            }
            const chatTarget = e.target as HTMLElement;
            const chatsContainer = (DBState.db.fixedChatTextarea && chatTarget.children[1]) ? chatTarget.children[1] : chatTarget.children[0];
            const lastEl = chatsContainer?.firstElementChild;
            const isAtBottom = lastEl ? lastEl.getBoundingClientRect().top <= chatTarget.getBoundingClientRect().bottom + 100 : true;
            if(isAtBottom){
                showNewMessageButton = false;
            }
        }}>
            <div
                    class="{DBState.db.fixedChatTextarea ? 'sticky pt-2 pb-2 right-0 bottom-0 bg-bgcolor' : 'mt-2 mb-2'} flex items-stretch w-full"
                    style="{DBState.db.fixedChatTextarea ? 'z-index:29;' : ''}"
            >
                {#if DBState.db.useChatSticker && currentCharacter.type !== 'group'}
                    <div onclick={()=>{toggleStickers = !toggleStickers}}
                         class={"ml-4 bg-textcolor2 flex justify-center items-center  w-12 h-12 rounded-md hover:bg-blue-500 transition-colors "+(toggleStickers ? 'text-green-500':'text-textcolor')}>
                        <Laugh/>
                    </div>
                {/if}

                <textarea class="peer text-input-area focus:border-textcolor transition-colors outline-hidden text-textcolor p-2 min-w-0 border border-r-0 bg-transparent rounded-md rounded-r-none input-text text-xl grow ml-4 border-darkborderc resize-none overflow-y-hidden overflow-x-hidden max-w-full placeholder:text-sm"
                          bind:value={() => shownDraft.messageInput, (value) => writeDraft((record) => { record.messageInput = value })}
                          bind:this={inputEle}
                          readonly={isComposerLocked()}
                          onkeydown={(e) => {
                        if(e.key.toLocaleLowerCase() === "enter" && !e.isComposing){
                            if(DBState.db.sendWithEnter && (!e.shiftKey)){
                                send()
                                e.preventDefault()
                            }else if(!DBState.db.sendWithEnter && e.shiftKey){
                                send()
                                e.preventDefault()
                            }
                        }
                        if(e.key.toLocaleLowerCase() === "m" && (e.ctrlKey)){
                            reroll()
                            e.preventDefault()
                        }
                    }}
                          onpaste={(e) => {
                        // A readonly textarea still fires paste; the lock is
                        // checked here, when the paste starts, so a paste
                        // that started before the lock still lands its
                        // result once it resolves.
                        if(isComposerLocked()){
                            return
                        }
                        const items = e.clipboardData?.items
                        if(!items){
                            return
                        }
                        let canceled = false

                        for(const item of items){
                            if(item.kind === 'file' && item.type.startsWith('image')){
                                if(!canceled){
                                    e.preventDefault()
                                    canceled = true
                                }
                                const file = item.getAsFile()
                                if(file){
                                    // The key is captured here, at the
                                    // start, so the result lands in the chat
                                    // this paste began in, even when a
                                    // switch moves a different chat on
                                    // screen before it resolves.
                                    const key = resolveDraftKeyForWrite()
                                    const hint = resolveOriginHintForWrite()
                                    const reader = new FileReader()
                                    reader.onload = async (e) => {
                                        const buf = e.target?.result as ArrayBuffer
                                        const uint8 = new Uint8Array(buf)
                                        const results = await postChatFile({
                                            name: file.name,
                                            data: uint8
                                        }, key, hint)
                                        if(!results) return
                                        writeDraftAt(key, (record) => {
                                            for(const res of results){
                                                if(res?.type === 'asset'){
                                                    record.fileInput.push(res.data)
                                                }
                                                if(res?.type === 'text'){
                                                    record.messageInput += `{{file::${res.name}::${res.data}}}`
                                                }
                                            }
                                        })
                                    }
                                    reader.readAsArrayBuffer(file)
                                }
                            }
                        }
                    }}
                          oninput={()=>{updateInputTransateMessage(false)}}
                          style:height={inputHeight}
                ></textarea>


                {#if $doingChat || isComposerBusy() || doingChatInputTranslate}
                    <button
                            aria-labelledby="cancel"
                            class="peer-focus:border-textcolor  flex justify-center border-y border-darkborderc items-center text-textcolor p-3 hover:bg-blue-500 hover:text-white transition-colors" onclick={abortChat}
                            style:height={inputHeight}
                    >
                        <div class="loadmove chat-process-stage-{$chatProcessStage}" class:autoload={isAutoModeActive()}></div>
                    </button>
                {:else}
                    <button
                            onclick={send}
                            class="flex justify-center border-y border-darkborderc items-center text-textcolor p-3 peer-focus:border-textcolor hover:bg-blue-500 hover:text-white transition-colors button-icon-send"
                            style:height={inputHeight}
                    >
                        <Send />
                    </button>
                {/if}
                {#if DBState.db.characters[$selectedCharID]?.chaId !== '§playground'}
                    <button
                            onclick={(e) => {
                            openMenu = !openMenu
                            e.stopPropagation()
                        }}
                            class="peer-focus:border-textcolor mr-2 flex border-y border-r border-darkborderc justify-center items-center text-textcolor p-3 rounded-r-md hover:bg-blue-500 hover:text-white transition-colors"
                            style:height={inputHeight}
                    >
                        <MenuIcon />
                    </button>
                {:else}
                    <div onclick={(e) => {
                        DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.push({
                            role: 'char',
                            data: ''
                        })
                        DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage] = DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage]
                    }}
                         class="peer-focus:border-textcolor mr-2 flex border-y border-r border-darkborderc justify-center items-center text-textcolor p-3 rounded-r-md hover:bg-blue-500 hover:text-white transition-colors"
                         style:height={inputHeight}
                    >
                        <Plus />
                    </div>
                {/if}
            </div>
            {#if DBState.db.useAutoTranslateInput && DBState.db.characters[$selectedCharID]?.chaId !== '§playground'}
                <div class="flex items-center mt-2 mb-2">
                    <label for='messageInputTranslate' class="text-textcolor ml-4">
                        <LanguagesIcon />
                    </label>
                    <textarea id = 'messageInputTranslate' class="text-textcolor rounded-md p-2 min-w-0 bg-transparent input-text text-xl grow ml-4 mr-2 border-darkbutton resize-none focus:bg-selected overflow-y-hidden overflow-x-hidden max-w-full"
                              bind:value={() => shownDraft.messageInputTranslate, (value) => writeDraft((record) => { record.messageInputTranslate = value })}
                              bind:this={inputTranslateEle}
                              readonly={isComposerLocked()}
                              onkeydown={(e) => {
                            if(e.key.toLocaleLowerCase() === "enter" && (!e.shiftKey)){
                                if(DBState.db.sendWithEnter){
                                    send()
                                    e.preventDefault()
                                }
                            }
                            if(e.key.toLocaleLowerCase() === "m" && (e.ctrlKey)){
                                reroll()
                                e.preventDefault()
                            }
                        }}
                              oninput={()=>{updateInputTransateMessage(true)}}
                              placeholder={language.enterMessageForTranslateToEnglish}
                              style:height={inputTranslateHeight}
                    ></textarea>
                </div>
            {/if}

            {#if shownDraft.fileInput.length > 0}
                <div class="flex items-center ml-4 flex-wrap p-2 m-2 border-darkborderc border rounded-md">
                    {#each shownDraft.fileInput as file, i}
                        {#await getInlayAsset(file) then inlayAsset}
                            <div class="relative">
                                {#if inlayAsset.type === 'image'}
                                    <img src={inlayAsset.data} alt="Inlay" class="max-w-48 max-h-48 border border-darkborderc">
                                {:else if inlayAsset.type === 'video'}
                                    <video controls class="max-w-48 max-h-48 border border-darkborderc">
                                        <source src={inlayAsset.data} type="video/mp4" />
                                        <track kind="captions" />
                                        Your browser does not support the video tag.
                                    </video>
                                {:else if inlayAsset.type === 'audio'}
                                    <audio controls class="max-w-48 max-h-24 border border-darkborderc">
                                        <source src={inlayAsset.data} type="audio/mpeg" />
                                        Your browser does not support the audio tag.
                                    </audio>
                                {:else}
                                    <div class="max-w-24 max-h-24">{file}</div>
                                {/if}
                                <button class="absolute -right-1 -top-1 p-1 bg-darkbg text-textcolor rounded-md transition-colors hover:text-draculared focus:text-draculared" onclick={() => {
                                    writeDraft((record) => { record.fileInput.splice(i, 1) })
                                }}>
                                    <XIcon size={18} />
                                </button>
                            </div>
                        {/await}
                    {/each}
                </div>

            {/if}

            {#if toggleStickers}
                <div class="ml-4 flex flex-wrap">
                    <AssetInput currentCharacter={currentCharacter} onSelect={(additionalAsset)=>{
                        if(isComposerLocked()){
                            return
                        }
                        let fileType = 'img'
                        if(additionalAsset.length > 2 && additionalAsset[2]) {
                            const fileExtension = additionalAsset[2]
                            if(fileExtension === 'mp4' || fileExtension === 'webm')
                                fileType = 'video'
                            else if(fileExtension === 'mp3' || fileExtension === 'wav')
                                fileType = 'audio'
                        }
                        writeDraft((record) => {
                            record.messageInput += `<span class='notranslate' translate='no'>{{${fileType}::${additionalAsset[0]}}}</span> *${additionalAsset[0]} added*`
                        })
                    }}/>
                </div>
            {/if}

            {#if DBState.db.useAutoSuggestions}
                <Suggestion messageInput={(msg)=>writeDraft((record) => { record.messageInput = (
                    (DBState.db.subModel === "textgen_webui" || DBState.db.subModel === "mancer" || DBState.db.subModel.startsWith('local_')) && DBState.db.autoSuggestClean
                    ? msg.replace(/ +\(.+?\) *$| - [^"'*]*?$/, '')
                    : msg
                ) })} {send}/>
            {/if}

            {#if chatPanelStore.length > 0}
                <div class="mx-4 my-2 flex flex-col gap-2">
                    {#each chatPanelStore as panel (panel.id)}
                        <section class={`rounded-md border border-darkborderc bg-darkbg/80 p-3 text-textcolor ${panel.className ?? ''}`} data-plugin-chat-panel={panel.id}>
                            {@html panel.html}
                        </section>
                    {/each}
                </div>
            {/if}

            {#if DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message?.[0]?.data?.startsWith(coldStorageHeader)  }
                {#await preLoadChat($selectedCharID, DBState.db.characters[$selectedCharID].chatPage)}
                    <div class="w-full flex justify-center text-textcolor2 italic mb-12">
                        {language.loadingChatData}
                    </div>
                {:then a}
                    {@const coldNotice = coldChatNoticeText(a, DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[0]?.data?.slice(coldStorageHeader.length) ?? '')}
                    {#if coldNotice !== null}
                        <div class="w-full flex justify-center text-textcolor2 italic mb-12">
                            {coldNotice}
                        </div>
                    {:else}
                        <div></div>
                    {/if}
                {/await}
            {:else}

            {#if chatFoldedStateMessageIndex.index !== -1}
                <button class="w-full flex justify-center max-w-full p-4">
                    <Button className="max-w-xl w-full" onclick={() => {
                        loadPages += chatFoldedStateMessageIndex.index + 1
                        chatFoldedState.data = null
                    }}>
                        {language.loadMore}
                    </Button>
                </button>
            {/if}

            {#if matchColdStorageLoadErrorKey(currentChat[0]?.data)}
                {@const legacyErrorKey = matchColdStorageLoadErrorKey(currentChat[0]?.data)}
                {@const legacyRetryStateKey = coldChatRetryStateKey(currentCharacter?.chaId ?? '', legacyErrorKey ?? '')}
                {@const legacyRetryStatus = coldChatRetryState[legacyRetryStateKey]}
                {@const legacyView = legacyRetryView(legacyRetryStatus)}
                <!-- CHORE-07 stage 7c-2: this chat hit a failed cold read
                    before stage 7b shipped, and its message[0] still holds
                    the pre-7b error text rather than a live pointer. The
                    chat itself stays visible and usable below -- this is
                    just a small notice with a Retry button. -->
                <div class="w-full flex flex-col items-center gap-2 text-textcolor2 italic mb-4 px-4 text-center">
                    <p>{legacyView.text}</p>
                    {#if legacyView.detail !== null}
                        <p class="text-xs">{legacyView.detail}</p>
                    {/if}
                    {#if legacyView.showRetry}
                        <Button
                            disabled={legacyRetryStatus === 'pending' || $doingChat}
                            onclick={() => retryColdChatLoad(
                                currentCharacter?.chaId ?? '',
                                legacyErrorKey ?? '',
                                $selectedCharID,
                                currentCharacter?.chatPage ?? 0,
                            )}
                        >
                            {language.errors.coldStorageLegacyChatRetryButton}
                        </Button>
                    {/if}
                </div>
            {/if}

            <Chats
                bind:this={chatsInstance}
                messages={currentChat}
                loadPages={loadPages}
                windowResetToken={windowResetToken}
                onReroll={reroll}
                unReroll={unReroll}
                currentCharacter={currentCharacter}
                currentUsername={currentUsername}
                userIcon={userIcon}
                userIconPortrait={userIconPortrait}
                bind:hasNewUnreadMessage={showNewMessageButton}
            />

            {#if DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.length <= loadPages}
                {#if DBState.db.characters[$selectedCharID].type !== 'group' }
                    <Chat
                        character={createSimpleCharacter(DBState.db.characters[$selectedCharID])}
                        name={DBState.db.characters[$selectedCharID].name}
                        message={DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].fmIndex === -1 ? DBState.db.characters[$selectedCharID].firstMessage :
                            DBState.db.characters[$selectedCharID].alternateGreetings[DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].fmIndex]}
                        role='char'
                        img={getCharImage(DBState.db.characters[$selectedCharID].image, 'css')}
                        idx={-1}
                        altGreeting={DBState.db.characters[$selectedCharID].alternateGreetings.length > 0}
                        largePortrait={DBState.db.characters[$selectedCharID].largePortrait}
                        firstMessage={true}
                        onReroll={() => {
                            const cha = DBState.db.characters[$selectedCharID]
                            const chat = DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage]
                            if(cha.type !== 'group'){
                                if (chat.fmIndex >= (cha.alternateGreetings.length - 1)){
                                    chat.fmIndex = -1
                                }
                                else{
                                    chat.fmIndex += 1
                                }
                            }
                            DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage] = chat
                        }}
                        unReroll={() => {
                            const cha = DBState.db.characters[$selectedCharID]
                            const chat = DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage]
                            if(cha.type !== 'group'){
                                if (chat.fmIndex === -1){
                                    chat.fmIndex = (cha.alternateGreetings.length - 1)
                                }
                                else{
                                    chat.fmIndex -= 1
                                }
                            }
                            DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage] = chat
                        }}
                        isLastMemory={false}
                        currentPage={(DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].fmIndex ?? -1) + 2}
                        totalPages={DBState.db.characters[$selectedCharID].alternateGreetings.length + 1}

                    />
                    {#if (aiLawApplies() && DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.length === 0)}
                        <div class="ml-auto mr-auto mt-4 text-textcolor2 italic max-w-2/3 wrap-break-word text-center">
                            {language.aiGenerationWarning}
                        </div>
                    {/if}
                    {#if !DBState.db.characters[$selectedCharID].removedQuotes && DBState.db.characters[$selectedCharID].creatorNotes.length >= 2}
                        <CreatorQuote quote={DBState.db.characters[$selectedCharID].creatorNotes} onRemove={() => {
                            const cha = DBState.db.characters[$selectedCharID]
                            if(cha.type !== 'group'){
                                cha.removedQuotes = true
                            }
                            DBState.db.characters[$selectedCharID] = cha
                        }} />
                    {/if}
                {/if}
            {/if}

            {/if}

            {#if openMenu}
                <div class="{DBState.db.fixedChatTextarea ? 'fixed' : 'absolute'} right-2 bottom-16 p-5 bg-darkbg flex flex-col gap-3 text-textcolor rounded-md" onclick={(e) => {
                    e.stopPropagation()
                }}>
                    {#if DBState.db.characters[$selectedCharID].type === 'group'}
                        <div class="flex items-center cursor-pointer hover:text-green-500 transition-colors" onclick={runAutoMode}>
                            <DicesIcon />
                            <span class="ml-2">{language.autoMode}</span>
                        </div>
                    {/if}

                    
                    <!-- svelte-ignore block_empty -->
                    {#if DBState.db.characters[$selectedCharID].ttsMode === 'webspeech' || DBState.db.characters[$selectedCharID].ttsMode === 'elevenlab'}
                        <div class="flex items-center cursor-pointer hover:text-green-500 transition-colors" onclick={() => {
                            stopTTS()
                        }}>
                            <MicOffIcon />
                            <span class="ml-2">{language.ttsStop}</span>
                        </div>
                    {/if}

                    <div class="flex items-center cursor-pointer hover:text-green-500 transition-colors"
                        class:text-textcolor2={(DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.length < 2) || (DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.length - 1].role !== 'char')}
                        onclick={() => {
                            if((DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.length < 2) || (DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message.length - 1].role !== 'char')){
                                return
                            }
                            sendContinue();
                        }}
                    >
                        <StepForwardIcon />
                        <span class="ml-2">{language.continueResponse}</span>
                    </div>


                    {#if DBState.db.showMenuChatList}
                        <div class="flex items-center cursor-pointer hover:text-green-500 transition-colors" onclick={() => {
                            openChatList = true
                            openMenu = false
                        }}>
                            <DatabaseIcon />
                            <span class="ml-2">{language.chatList}</span>
                        </div>
                    {/if}

                    
                    {#if DBState.db.enableRisuaiProTools}
                        <div class="flex items-center cursor-pointer hover:text-green-500 transition-colors" onclick={() => {
                            easyPanelStore.open = !easyPanelStore.open
                        }}>
                            <SparkleIcon />
                            <span class="ml-2">{language.easyPanel}</span>
                        </div>
                    {/if}

                    {#each additionalChatMenu as menu}
                        <div class="flex items-center cursor-pointer hover:text-green-500 transition-colors" onclick={() => {
                            menu.callback()
                            openMenu = false
                        }}>
                            <PluginDefinedIcon ico={menu} />
                            <span class="ml-2">{menu.name}</span>
                        </div>
                    {/each}

                    {#if DBState.db.showMenuHypaMemoryModal}
                        {#if (DBState.db.supaModelType !== 'none' && DBState.db.hypav2) || DBState.db.hypaV3}
                            <div class="flex items-center cursor-pointer hover:text-green-500 transition-colors" onclick={() => {
                                if (DBState.db.hypav2) {
                                    DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].hypaV2Data ??= {
                                        lastMainChunkID: 0,
                                        mainChunks: [],
                                        chunks: [],
                                    }
                                    showHypaV2Alert();
                                } else if (DBState.db.hypaV3) {
                                    $hypaV3ModalOpen = true
                                }

                                openMenu = false
                            }}>
                                <BrainIcon />
                                <span class="ml-2">
                                    {DBState.db.hypav2 ? language.hypaMemoryV2Modal : language.hypaMemoryV3Modal}
                                </span>
                            </div>
                        {/if}
                    {/if}
                    
                    {#if DBState.db.translator !== ''}
                        <div class={"flex items-center cursor-pointer "+ (DBState.db.useAutoTranslateInput ? 'text-green-500':'lg:hover:text-green-500')} onclick={() => {
                            DBState.db.useAutoTranslateInput = !DBState.db.useAutoTranslateInput
                        }}>
                            <GlobeIcon />
                            <span class="ml-2">{language.autoTranslateInput}</span>
                        </div>
                        
                    {/if}
            
                    <div class="flex items-center cursor-pointer hover:text-green-500 transition-colors" onclick={() => {
                        screenShot()
                    }}>
                        <CameraIcon />
                        <span class="ml-2">{language.screenshot}</span>
                    </div>

                    <div class="flex items-center cursor-pointer hover:text-green-500 transition-colors" onclick={async () => {
                        if(isComposerLocked()){
                            return
                        }
                        // The key is captured here, at the start, so the
                        // result lands in the chat this Post File began in,
                        // even when a switch moves a different chat on
                        // screen before it resolves.
                        const key = resolveDraftKeyForWrite()
                        const hint = resolveOriginHintForWrite()
                        const results = await postChatFile(composerDrafts.peek(key).messageInput, key, hint)
                        if(!results) return
                        writeDraftAt(key, (record) => {
                            for(const res of results){
                                if(res?.type === 'asset'){
                                    record.fileInput.push(res.data)
                                }
                                if(res?.type === 'text'){
                                    record.messageInput += `{{file::${res.name}::${res.data}}}`
                                }
                            }
                        })
                    }}>

                        <ImagePlusIcon />
                        <span class="ml-2">{language.postFile}</span>
                    </div>


                    <div class={"flex items-center cursor-pointer "+ (DBState.db.useAutoSuggestions ? 'text-green-500':'lg:hover:text-green-500')} onclick={async () => {
                        DBState.db.useAutoSuggestions = !DBState.db.useAutoSuggestions
                    }}>
                        <ReplyIcon />
                        <span class="ml-2">{language.autoSuggest}</span>
                    </div>


                    <div class="flex items-center cursor-pointer hover:text-green-500 transition-colors" onclick={() => {
                        DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].modules ??= []
                        openModuleList = true
                        openMenu = false
                    }}>
                        <PackageIcon />
                        <span class="ml-2">{language.modules}</span>
                    </div>

                    {#if DBState.db.sideMenuRerollButton}
                        <div class="flex items-center cursor-pointer hover:text-green-500 transition-colors" onclick={reroll}>
                            <RefreshCcwIcon />
                            <span class="ml-2">{language.reroll}</span>
                        </div>
                    {/if}
                </div>

            {/if}
        </div>

    {/if}
</div>

{#if additionalFloatingActionButtons.length > 0}
    <div class="fixed top-4 right-4 flex flex-col gap-3 z-50">
        {#each additionalFloatingActionButtons as button}
            <button class="bg-blue-500 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 hover:bg-blue-600 transition-colors" onclick={() => {
                button.callback()
            }}>
                <PluginDefinedIcon ico={button} />
            </button>
        {/each}
    </div>
{/if}
<style>

    .chat-process-stage-1{
        border-top: 0.4rem solid #60a5fa;
        border-left: 0.4rem solid #60a5fa;
    }

    .chat-process-stage-2{
        border-top: 0.4rem solid #db2777;
        border-left: 0.4rem solid #db2777;
    }

    .chat-process-stage-3{
        border-top: 0.4rem solid #34d399;
        border-left: 0.4rem solid #34d399;
    }

    .chat-process-stage-4{
        border-top: 0.4rem solid #8b5cf6;
        border-left: 0.4rem solid #8b5cf6;
    }

    .autoload{
        border-top: 0.4rem solid #10b981;
        border-left: 0.4rem solid #10b981;
    }

    @keyframes spin {
        
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
</style>
