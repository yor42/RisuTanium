<script lang="ts">
    import { ArrowLeft, ArrowLeftToLine, ArrowLeftRightIcon, ArrowRight, BookmarkIcon, BotIcon, CopyIcon, IdCardIcon, PowerOff, GitBranch, HamburgerIcon, History, LanguagesIcon, MenuIcon, PencilIcon, RefreshCcwIcon, RotateCcw, SplitIcon, TrashIcon, UserIcon, Volume2Icon, Scissors } from "@lucide/svelte"
    import { aiLawApplies, changeChatTo, foldChatToMessage } from "src/ts/globalApi.svelte"
    import { type CopyOutcome } from "src/ts/chatCopy"
    import { CARD_DEADLINE_MS, CARD_PENDING_MARGIN_MS, type CardReport } from "src/ts/chatCard"
    import { ColorSchemeTypeStore } from "src/ts/gui/colorscheme"
    import { longpress } from "src/ts/gui/longtouch"
    import { LIGHT_SURFACE_STYLE } from "src/ts/gui/lightSurface"
    import { getModelInfo } from "src/ts/model/modellist"
    import { risuChatParser } from "src/ts/process/scripts"
    import { recordCaughtError } from "src/ts/caughtErrors"
    import { withSupaRepoint } from "src/ts/process/memory/supaResume"
    import { requestRemove, handleButtonTriggerWithin as runButtonTriggerWithin, handleFormTriggerWithin as runFormTriggerWithin, toggleBookmark as toggleMessageBookmark, copyMessageText, copyMessageAsCard, playMessageTTS, branchMessage, toggleMessageDisabled } from "src/ts/process/messageActions.svelte"
    import { endTarget, siblingsAt } from "src/ts/process/chatTree"
    import { rerollBase } from "src/ts/process/rerollHistory"
    import type { TreeView } from "src/ts/process/chatTreeView"
    import { ensureCurrentModulesOrAlert } from 'src/ts/process/moduleEnsure'
    import { hasModuleStubs } from 'src/ts/process/moduleRefList'
    import { registerMessageRoot } from "src/ts/messageRootRegistry"
    import { buildDisplayParseOptions } from "src/ts/process/displayParseOptions"
    import { isTTSVoiceMode } from "src/ts/process/ttsModes"
    import { DBState, ReloadChatPointer, popupStore } from 'src/ts/stores.svelte'
    import { type MessageIdentity, type DraftRecord, draftIdentityKey } from "src/ts/draftContents"
    import { formatDraftAge } from "src/ts/draftAge"
    import { chatWindowKey } from "src/ts/chatWindowPolicy"
    import { capitalize, sleep } from "src/ts/util"
    import { onDestroy, onMount, untrack } from "svelte"
    import { fade } from "svelte/transition"
    import { type Unsubscriber } from "svelte/store"
    import { language } from "../../lang"
    import { alertError, alertRequestData } from "../../ts/alert"
    import { ParseMarkdown, type CbsConditions, type simpleCharacterArgument } from "../../ts/parser/parser.svelte"
    import { getCurrentCharacter, type Message, type MessageGenerationInfo, type StreamingDisplayOptimizationMode } from "../../ts/storage/database.svelte"
    import { selectedCharID } from "../../ts/stores.svelte"
    import { HideIconStore, ReloadGUIPointer, selIdState } from "../../ts/stores.svelte"
    import AutoresizeArea from "../UI/GUI/TextAreaResizable.svelte"
    import ChatBody from './ChatBody.svelte'
    import { viewportWidthThisTask } from './chatViewportWidth'
    import PopupButton from "../UI/PopupButton.svelte";
    import PartialEditController from './PartialEditController.svelte';
    import { getLLMCache } from "../../ts/translator/translator"
    import { chatSurface, isChatSurfaceInstalled } from "./chatSurface.svelte"
    import { createMessageEditorController } from "src/ts/process/messageEditorController.svelte"

    let translating = $state(false)
    let statusMessage:string = $state('')
    let retranslate = $state(false)
    let chatBodyRevision = $state(0)
    let bodyRoot:HTMLElement|null = $state(null)
    interface Props {
        message?: string;
        name?: string;
        largePortrait?: boolean;
        isLastMemory: boolean;
        img?: string|Promise<string>;
        idx?: number;
        messageGenerationInfo?: MessageGenerationInfo|null;
        rerollIcon?: boolean|'dynamic';
        role?: string;
        totalLength?: number;
        onReroll?: () => void;
        unReroll?: () => void;
        character?: simpleCharacterArgument|string|null;
        firstMessage?: boolean;
        altGreeting?: boolean;
        currentPage?: number;
        totalPages?: number;
        isComment?: boolean;
        disabled?: boolean | 'allBefore';
        isOptimizedStreamingMessage?: boolean;
        streamingOptimizationMode?: StreamingDisplayOptimizationMode;
        rawStreamingText?: string;
        /** The reply was left unfinished when the page last ran; shows a note under it. */
        interrupted?: boolean;
        /** True only for the Chats tail while its reply streams; Chats carries the same fact in the row's hash, so the row is re-mounted when it ends. */
        deferAutoTranslate?: boolean;
        /** Live: true while the Chats tail's reply streams in place; a translated view then waits for the stream end. */
        translationHold?: boolean;
        /** Mount-time: the tail replaces an instance that showed the translated view, so this one starts in it. */
        startTranslated?: boolean;
        /** The chat id this row's message had when the row was mounted; a tree press acts only while the message at `idx` still has it. */
        expectedId?: string;
        /** Steps the sibling at `idx`: the arrows and the end control press through it. */
        onStep?: (index: number, expectedId: string | undefined, direction: 'back' | 'forward') => void;
        /** Ends the path at the message at `idx`. */
        onBranch?: (index: number, expectedId: string | undefined) => void;
        /** The chat's sibling view, read live so a row never remounts for it. */
        getTreeView?: () => TreeView | null;
        /** True while a generation or a composer action runs. */
        getBusy?: () => boolean;
        /** A row of the kept-mounted chat surface: it holds its parsing while Settings covers the chat and dies on a rebuild return. */
        surface?: boolean;
    }

    let {
        message = $bindable(''),
        name = '',
        largePortrait = false,
        isLastMemory,
        img = '',
        idx = -1,
        rerollIcon = false,
        messageGenerationInfo = null,
        role = null,
        totalLength = 0,
        onReroll = () => {},
        unReroll = () => {},
        character = null,
        firstMessage = false,
        altGreeting = false,
        currentPage = 1,
        totalPages = 1,
        isComment = false,
        disabled = false,
        isOptimizedStreamingMessage = false,
        streamingOptimizationMode = 'off',
        rawStreamingText = message,
        interrupted = false,
        deferAutoTranslate = false,
        translationHold = false,
        startTranslated = false,
        expectedId = undefined,
        onStep = undefined,
        onBranch = undefined,
        getTreeView = undefined,
        getBusy = undefined,
        surface = false,
    }: Props = $props();

    // A surface row without an installed surface behaves as any other row. Otherwise it records the rebuild epoch it
    // was created under: after a rebuild return every older row (and the bodies inside it) is dead and never parses,
    // whatever order the flush visits the roots in.
    const surfaceEpoch: number | null = untrack(() => surface) && isChatSurfaceInstalled()
        ? untrack(() => chatSurface.rebuildEpoch)
        : null
    const surfaceDead = () => surfaceEpoch !== null && surfaceEpoch !== chatSurface.rebuildEpoch

    // The tree controls read the live chat, never the mount-time props: `totalLength` and the sibling view
    // are fixed or shared, and a row must not remount when a send or a switch changes them.
    let liveChat = $derived(DBState.db.characters?.[selIdState.selId]?.chats?.[DBState.db.characters?.[selIdState.selId]?.chatPage])
    let liveLength = $derived(liveChat?.message?.length ?? 0)
    let isLastRow = $derived(idx > -1 && idx === liveLength - 1)
    let treeBusy = $derived(getBusy?.() ?? false)
    let treeControls = $derived(rerollIcon !== false && !altGreeting && onStep !== undefined)
    let sibling = $derived(getTreeView?.()?.at(idx) ?? null)
    let siblingIndex = $derived(sibling?.index ?? 1)
    let siblingCount = $derived(sibling?.count ?? 1)
    let willGenerate = $derived(isLastRow && siblingIndex >= siblingCount && !!liveChat && rerollBase(liveChat.message) !== null)
    let endCount = $derived(treeControls && isLastRow && liveChat && endTarget(liveChat) !== null ? siblingsAt(liveChat, liveLength).length : 0)
    let branchDisabled = $derived(treeBusy || !(idx < liveLength - 1))

    let rootChatId = $derived(DBState.db.characters?.[selIdState.selId]?.chats?.[DBState.db.characters?.[selIdState.selId]?.chatPage]?.message?.[idx]?.chatId ?? '')
    let msgDisplay = $state('')
    let renderFailed = $state(false)
    let translated = $state(untrack(() => startTranslated))
    // Handed to the body once: its first decision would otherwise reset the view, and a later re-keyed body decides afresh.
    let startTranslatedPending = untrack(() => startTranslated)
    const takeStartTranslated = () => {
        const pending = startTranslatedPending
        startTranslatedPending = false
        return pending
    }
    let partialEditEnabled = $state(true)
    const editor = createMessageEditorController({
        getMessage: () => message,
        setMessage: (value) => { message = value },
        getIdx: () => idx,
        currentMessageIdentity,
        getTranslationCacheKey,
        translationOpenToken,
        translationOpenCurrent,
        isDestroyed: () => destroyed,
        onTranslationCacheWritten: () => { chatBodyRevision += 1 },
    })
    // The restore marker's fade-in (MC-068: "about 150ms", none under
    // prefers-reduced-motion). Copied from `SourceDisclosure.svelte`'s guard:
    // happy-dom (this component's own test environment) has no
    // `Element.prototype.animate`, which Svelte's `fade` transition builds
    // its keyframes through, and a zero duration is the one input that makes
    // it skip that call and finish synchronously instead.
    let reduceMotion = $state(false)
    $effect(() => {
        const mql = window.matchMedia("(prefers-reduced-motion: reduce)")
        reduceMotion = mql.matches
        function handleChange(event: MediaQueryListEvent) {
            reduceMotion = event.matches
        }
        mql.addEventListener("change", handleChange)
        return () => mql.removeEventListener("change", handleChange)
    })
    const supportsAnimate = typeof Element !== "undefined" && typeof Element.prototype.animate === "function"
    const markerTransitionDuration = $derived(reduceMotion || !supportsAnimate ? 0 : 150)

    // Any surface that renders `textBox()` (or the `cardboard` raw textarea)
    // against a hardcoded light background needs the marker's fixed light
    // palette instead of the default theme tokens: on a dark colour scheme
    // those tokens are light text, which fails contrast against a background
    // that stays light regardless of the scheme. `mobilechat`'s bubble
    // (`bg-gray-100`) and
    // `cardboard`'s card (its gray-100-to-gray-200 gradient) are both always
    // light regardless of the app's own dark/light setting -- unlike the
    // default theme's own message row, which has no hardcoded background
    // and so correctly keeps using theme tokens that already track
    // `$ColorSchemeTypeStore`. `customHTML` is a third `textBox()` call site
    // (via a `<RISUTEXTBOX>` tag inside `renderGuiHtmlPart`) but is
    // deliberately excluded: its surrounding background is arbitrary
    // user-authored CSS with no fixed value this component could target.
    let markerOnLightSurface = $derived(DBState.db.theme === 'mobilechat' || DBState.db.theme === 'cardboard')

    function currentMessageIdentity(): MessageIdentity {
        const chatCharacter = DBState.db.characters[selIdState.selId]
        const chat = chatCharacter?.chats?.[chatCharacter.chatPage]
        return {
            kind: 'msg',
            chatKey: chatWindowKey(chatCharacter?.chaId, chat),
            chatId: chat?.message?.[idx]?.chatId,
            index: idx,
        }
    }

    function translationOpenToken(): { identity: string; row: Message | undefined; data: string | undefined; closeEpoch: number } {
        const character = DBState.db.characters[selIdState.selId]
        const row = character?.chats?.[character.chatPage]?.message?.[idx]
        return {
            identity: draftIdentityKey(currentMessageIdentity()),
            row,
            data: row?.data,
            closeEpoch: chatSurface.closeEpoch,
        }
    }

    function translationOpenCurrent(token: ReturnType<typeof translationOpenToken>): boolean {
        const character = DBState.db.characters[selIdState.selId]
        return !destroyed
            && token.closeEpoch === chatSurface.closeEpoch
            && token.identity === draftIdentityKey(currentMessageIdentity())
            && token.row === character?.chats?.[character.chatPage]?.message?.[idx]
            && token.data === token.row?.data
    }

    export function updateStreamingDisplay(state: {
        isOptimizedStreamingMessage: boolean
        streamingOptimizationMode: StreamingDisplayOptimizationMode
        rawStreamingText: string
    }){
        isOptimizedStreamingMessage = state.isOptimizedStreamingMessage
        streamingOptimizationMode = state.streamingOptimizationMode
        rawStreamingText = state.rawStreamingText
    }

    export function isTranslatedView(): boolean {
        return translated
    }

    async function rm(e:MouseEvent | TouchEvent, rec?:boolean){
        if(e.shiftKey){
            const shiftChat = DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage]
            withSupaRepoint(shiftChat, () => {
                shiftChat.message = shiftChat.message.slice(0, idx)
            })
            return
        }

        // The owner, chat and message are fixed here; the answers arrive later and
        // must act on these, never on whatever is selected or sits at `idx` then.
        const owner = DBState.db.characters[selIdState.selId]
        const chat = owner?.chats[owner.chatPage]
        const target = chat?.message[idx]
        if(!owner || !chat || !target){
            return
        }

        await requestRemove(owner, chat, target, { rec })
    }

    function toggleTranslation() {
        if (editor.translationViewControlsDisabled) return
        translated = !translated
    }

    function requestRetranslation() {
        if (editor.translationViewControlsDisabled) return
        retranslate = true
    }

    async function handlePartialEditSave(e: CustomEvent<{ newData: string; target: 'original' | 'translation'; translationKey?: string }>) {
        if (idx < 0) return

        if (e.detail.target === 'translation') {
            if (!e.detail.translationKey) return

            // The partial editor has already closed when this runs, so a failed
            // write is reported and the edited text is not recoverable from it.
            try {
                await editor.updateTranslationCache(e.detail.translationKey, e.detail.newData)
            } catch (error) {
                alertError(error)
            }
            return
        }

        message = e.detail.newData
        const edited = DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage].message[idx]
        edited.data = e.detail.newData
        delete edited.interrupted
        displaya(e.detail.newData)
    }

    async function getTranslationPartialEditContext(): Promise<{ key: string; data: string } | null | 'unavailable'> {
        if (!translated || DBState.db.translatorType !== 'llm') {
            return null
        }

        const token = translationOpenToken()
        const key = await getTranslationCacheKey()
        if (!translationOpenCurrent(token)) return 'unavailable'
        if (key === null) return 'unavailable'
        if (!key) {
            return null
        }
        const data = await getLLMCache(key)
        if (!translationOpenCurrent(token)) return 'unavailable'
        if (data === null) {
            return null
        }

        return { key, data }
    }

    function getCbsCondition(){
        try{
            const cbsConditions:CbsConditions = {
                firstmsg: firstMessage ?? false,
                chatRole: DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage]?.message?.[idx]?.role ?? null,
            }
            return cbsConditions
        }
        catch(e){
            return {
                firstmsg: firstMessage ?? false,
                chatRole: null,
            }
        }
    }

    async function getTranslationCacheKey(): Promise<string | null> {
        if(DBState.db.translateBeforeHTMLFormatting){
            return msgDisplay
        }
        // A key built from a stub cannot match the translator's key after that module loads.
        if (hasModuleStubs() && !(await ensureCurrentModulesOrAlert())) return null
        if(!DBState.db.legacyTranslation){
            return await ParseMarkdown(msgDisplay, character, 'pretranslate', idx, getCbsCondition())
        }
        return await ParseMarkdown(msgDisplay, character, 'notrim', idx, getCbsCondition())
    }

    function displayParseOptions(){
        const conditions = getCbsCondition()
        return buildDisplayParseOptions({chara: name, chatID: idx, firstmsg: conditions.firstmsg, chatRole: conditions.chatRole ?? null})
    }

    // A parse failure keeps this Chat alive: the raw text is shown with a note, and Edit and the buttons still work.
    // While `renderFailed`, `msgDisplay` holds the unparsed text, so the translation cache key and the copied text
    // are the raw message too. `msgDisplay` is display state only and is never persisted; saves write `message`.
    // The next successful parse clears the flag.
    function displaya(message:string){
        try{
            msgDisplay = risuChatParser(message, displayParseOptions())
            renderFailed = false
        }
        catch(error){
            recordCaughtError('chat.parse', error)
            msgDisplay = message
            renderFailed = true
        }
    }

    // At most one status timer is pending, and it only clears the status text it was
    // started for, so an older status never wipes a newer one.
    let statusTimer: ReturnType<typeof setTimeout> | undefined
    let destroyed = false

    const setStatusMessage = (message:string, timeout:number)=>{
        clearTimeout(statusTimer)
        statusMessage = message
        statusTimer = setTimeout(() => {
            statusTimer = undefined
            if(statusMessage === message){
                statusMessage = ''
            }
        }, timeout)
    }

    const reportCopy = (outcome:CopyOutcome)=>{
        if(destroyed) return
        if('errorName' in outcome){
            setStatusMessage(`${outcome.errorName}: ${language.copyFailed}`, 10000)
        }
        else{
            setStatusMessage(language.copied, 3000)
        }
    }

    // The text a copy puts on the clipboard: what the message shows, or the
    // parsed raw text while a strong-optimised stream is rendered raw.
    const currentCopyText = ():string => renderRawStreaming
        ? risuChatParser(rawStreamingText, displayParseOptions())
        : msgDisplay

    // Identifies this message component to the card copy: the same message is
    // this instance, never its index, which repeats across chat pages.
    const cardOwner = {}

    const reportCard = (report:CardReport)=>{
        if(destroyed) return
        switch(report.kind){
            case 'loading':
                setStatusMessage(language.loading, CARD_DEADLINE_MS + CARD_PENDING_MARGIN_MS)
                break
            case 'copied':
                setStatusMessage(language.copied, 3000)
                break
            case 'simple':
                setStatusMessage(language.copiedSimpleCard, 5000)
                break
            case 'text':
                setStatusMessage(language.copiedAsText, 5000)
                break
            case 'failed':
                setStatusMessage(`${report.errorName}: ${language.copyFailed}`, 10000)
                break
            case 'superseded':
                // A newer copy owns the status; only this card's own loading text is cleared.
                if(statusMessage === language.loading){
                    clearTimeout(statusTimer)
                    statusTimer = undefined
                    statusMessage = ''
                }
                break
        }
    }

    // Every input of the card is read here, at the click, so a later change of
    // the selected character, theme or message cannot alter a card in flight.
    const copyAsCard = () => copyMessageAsCard({
        owner: cardOwner,
        captureText: currentCopyText,
        report: reportCard,
        role: () => role,
        name: () => name,
        messageGenerationInfo: () => messageGenerationInfo,
        idx: () => idx,
        getCbsCondition,
    })


    let blankMessage = $derived((message === '{{none}}' || message === '{{blank}}' || message === '') && idx === -1 || isComment)

    // Whether an icon button renders. The "..." popup asks the same functions, so
    // an item and the popup that holds it cannot disagree. A first message
    // (idx -1) is not a stored message: no action that targets `message[idx]`
    // is offered for it.
    const copyButtonShown = () => !!DBState.db.useChatCopy && !blankMessage
    const copyAsCardShown = () => copyButtonShown() && typeof ClipboardItem === 'function' && typeof navigator.clipboard?.write === 'function'
    const speakerButtonShown = () => (idx > -1 || (firstMessage && !blankMessage))
        && DBState.db.characters[selIdState.selId]?.type !== 'group'
        && isTTSVoiceMode(DBState.db.characters[selIdState.selId]?.ttsMode)
    const popupHasItems = (withMajorItems:boolean) => idx > -1
        || copyAsCardShown()
        || (withMajorItems && (copyButtonShown() || speakerButtonShown()))
    let displayMessage = $derived(isOptimizedStreamingMessage ? rawStreamingText : message)
    let renderRawStreaming = $derived(isOptimizedStreamingMessage && streamingOptimizationMode === 'strong')

    function updateDisplayedMessage(){
        if(renderRawStreaming){
            return
        }
        displaya(displayMessage)
    }

    // A surface row does not track `hidden` while it runs normally, so an idle visit runs nothing. A dependency
    // change while hidden runs the effect once, which skips and subscribes to `hidden`; the release then parses once.
    // A dead row never parses.
    $effect.pre(() => {
        if(surfaceEpoch !== null){
            if(untrack(() => chatSurface.hidden)){
                void chatSurface.hidden
                return
            }
            if(untrack(surfaceDead)){
                return
            }
        }
        updateDisplayedMessage()
    });

    const unsubscribers:Unsubscriber[] = []

    // The icon's {#await} block retains the batch it was created in for its whole life.
    // Creating it in the batch that mounts this component would keep that batch's
    // previous-value map (e.g. the previous chat's message array) reachable until the
    // component is destroyed, so the await is only created after mounting has finished.
    let iconMounted = $state(false)

    onMount(()=>{
        queueMicrotask(() => { iconMounted = true })
        unsubscribers.push(ReloadGUIPointer.subscribe((v) => {
            if(surfaceEpoch !== null && (chatSurface.hidden || surfaceDead())){
                return
            }
            updateDisplayedMessage()
        }))
    })

    onDestroy(()=>{
        destroyed = true
        clearTimeout(statusTimer)
        unsubscribers.forEach(u => u())
        // Dispose releases draft registrations even when teardown effects have not flushed.
        editor.dispose()
    })

    function RenderGUIHtml(html:string){
        try {
            const parser = new DOMParser()
            const doc = parser.parseFromString(risuChatParser(html ?? '', {cbsConditions: getCbsCondition()}), 'text/html')
            return doc.body   
        } catch (error) {
            const placeholder = document.createElement('div')
            return placeholder
        }
    }

    const handleButtonTriggerWithin = (event: UIEvent) => runButtonTriggerWithin(event, () => idx)
    const handleFormTriggerWithin = (event: SubmitEvent) => runFormTriggerWithin(event, () => idx)

    let isBookmarked = $derived(
        DBState.db.characters[selIdState.selId]
            ?.chats[DBState.db.characters[selIdState.selId].chatPage]
            ?.bookmarks?.includes(DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage].message[idx]?.chatId) ?? false
    );

    const toggleBookmark = () => toggleMessageBookmark(idx, name)
</script>


{#snippet genInfo()}
    <div class="flex flex-col items-end">
        {#if messageGenerationInfo && (DBState.db.requestInfoInsideChat || aiLawApplies())}
            <button class="text-sm p-1 text-textcolor2 border-darkborderc float-end mr-2 my-1
                    hover:ring-darkbutton hover:ring-3 rounded-md hover:text-textcolor transition-all flex justify-center items-center" 
                    onclick={() => {
                        const currentGenerationInfo = idx >= 0 ? 
                            DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[idx].generationInfo :
                            messageGenerationInfo

                        alertRequestData({
                            genInfo: currentGenerationInfo,
                            idx: idx,
                        })
                    }}
            >
                <BotIcon size={20} />
                <span class="ml-1">
                    {capitalize(getModelInfo(messageGenerationInfo.model).shortName)}
                </span>
            </button>
        {/if}
        {#if DBState.db.translatorType === 'llm' && translated}
            <button class={"text-sm p-1 text-textcolor2 border-darkborderc float-end mr-2 my-1 rounded-md transition-all flex justify-center items-center " + (editor.translationViewControlsDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:ring-darkbutton hover:ring-3 hover:text-textcolor')}
                    disabled={editor.translationViewControlsDisabled}
                    onclick={requestRetranslation}
            >
                <RefreshCcwIcon size={20} />
                <span class="ml-1">
                    {language.retranslate}
                </span>
            </button>
            <button class={"text-sm p-1 border-darkborderc float-end mr-2 my-1 rounded-md transition-all flex justify-center items-center " + (editor.editTranslationMode ? 'text-blue-400 hover:ring-darkbutton hover:ring-3 hover:text-textcolor' : editor.translationEditControlDisabled ? 'text-textcolor2 opacity-50 cursor-not-allowed' : 'text-textcolor2 hover:ring-darkbutton hover:ring-3 hover:text-textcolor')}
                    disabled={editor.translationEditControlDisabled}
                    onclick={() => {
                        if(editor.editTranslationMode){
                            editor.saveTranslationEdit().catch((error) => alertError(error))
                        } else {
                            editor.loadTranslationForEdit().catch((error) => alertError(error))
                        }
                    }}
            >
                <PencilIcon size={20} />
                <span class="ml-1">
                    {editor.editTranslationMode ? language.editTranslationSave : language.editTranslation}
                </span>
            </button>
        {/if}
    </div>
{/snippet}

{#snippet draftRestoreMarker(record: DraftRecord, onRevert: () => void, lightSurface: boolean)}
    <!--
      MC-068: shared by all three restore-marker surfaces (`textBox()`'s
      translation AutoresizeArea, its original-text AutoresizeArea, and the
      `cardboard` theme's raw textarea) -- one snippet, not three copies.
      `role="status"` makes it a live region; the Revert control is a native
      `<button>`. `lightSurface` (see `markerOnLightSurface` above) picks a
      fixed light palette (always light regardless of the app's own
      dark/light setting) instead of the default surfaces' theme tokens.
      The fade-in collapses to 0ms under
      `prefers-reduced-motion` or a missing `Element.prototype.animate` via
      `markerTransitionDuration` above (copied from `SourceDisclosure.svelte`'s
      guard).
    -->
    <!--
      Wraps: below roughly icon + 7rem (the label's `basis-28`) + button
      width, the button no longer fits beside the label and drops to its own
      line, right-aligned there by `ml-auto` (a no-op on the wide, unwrapped
      line, where the label's `grow` already claims all the free space).
    -->
    <div
        role="status"
        class={lightSurface
            ? "flex flex-wrap items-center gap-2 mb-1 rounded-md border border-gray-400 bg-gray-300/60 px-2 py-1 text-xs text-gray-700"
            : "flex flex-wrap items-center gap-2 mb-1 rounded-md border border-darkborderc bg-darkbutton/30 px-2 py-1 text-xs text-textcolor/70"}
        transition:fade={{ duration: markerTransitionDuration }}
    >
        <History size={14} class="shrink-0" />
        <span class="grow min-w-0 basis-28 break-keep wrap-anywhere">{language.draftRestored} · {formatDraftAge(record.updatedAt, Date.now(), DBState.db.language ?? '')}</span>
        <button
            type="button"
            class={lightSurface
                ? "flex items-center gap-1 ml-auto shrink-0 whitespace-nowrap rounded-sm px-1.5 py-0.5 font-medium text-gray-700 transition-colors hover:bg-gray-400/60 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-600"
                : "flex items-center gap-1 ml-auto shrink-0 whitespace-nowrap rounded-sm px-1.5 py-0.5 font-medium text-textcolor/70 transition-colors hover:bg-darkbutton hover:text-textcolor focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"}
            onclick={onRevert}
        >
            <RotateCcw size={14} class="shrink-0" />
            {language.draftRevert}
        </button>
    </div>
{/snippet}

{#snippet textBox()}
    {#if editor.editTranslationMode}
        {#if editor.restoredTranslationRecord}
            {@render draftRestoreMarker(editor.restoredTranslationRecord, editor.revertTranslationEdit, markerOnLightSurface)}
        {/if}
        <AutoresizeArea bind:value={editor.editTranslationText} onUserEdit={editor.captureTranslationEdit} handleLongPress={() => {
            editor.saveTranslationEdit().catch((error) => alertError(error))
        }} />
    {/if}
    {#if editor.editMode}
        {#if editor.restoredMessageRecord}
            {@render draftRestoreMarker(editor.restoredMessageRecord, editor.revertOriginalEdit, markerOnLightSurface)}
        {/if}
        <AutoresizeArea bind:value={editor.editBuffer} onUserEdit={editor.captureMessageEdit} lightSurface={DBState.db.theme === 'mobilechat'} handleLongPress={() => {
            // Mouse long-press on the original-text editor discards without asking.
            editor.discardOriginalEdit(editor.frozenMessageIdentity)
        }} />
    {:else if isComment}
        <div class="w-full flex justify-center text-textcolor2 italic mb-12">

            {#if msgDisplay.startsWith('{{specialcomment')}
                {@const parts = msgDisplay.split('::')}
                {@const type = parts[1]}

                {#if type === 'branchedfrom'}
                    <button class="text-blue-500 hover:underline"
                        onclick={() => {
                            console.log(parts)
                            changeChatTo(parts[2] ?? '')
                            foldChatToMessage(parts[4])
                        }}
                    >
                        <GitBranch size={20} class="inline-block mr-1" />
                        {language.branchedText.replace("{}", parts[3] ?? '')}
                    </button>
                {/if}
            {:else}
                {msgDisplay}
            {/if}
        </div>
    {:else if blankMessage}
        <div class="w-full flex justify-center text-textcolor2 italic mb-12">
            {language.noMessage}
        </div>
    {:else}
        {@const chatReloadPointer = surfaceEpoch !== null
            ? chatSurface.heldGui + (chatSurface.heldChat[idx] ?? 0)
            : $ReloadGUIPointer + ($ReloadChatPointer[idx] ?? 0)}
        {@const totalLengthPointer = (idx > totalLength - 6) ? totalLength : 0}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span class="text chat-width chattext prose minw-0"
            class:hidden={editor.editTranslationMode}
            class:prose-invert={$ColorSchemeTypeStore && !markerOnLightSurface}
            bind:this={bodyRoot}
            onclick={() => {
            if(DBState.db.clickToEdit && idx > -1 && !isOptimizedStreamingMessage){
                editor.startOriginalEdit()
            }
        }}
            style:font-size="{0.875 * (DBState.db.zoomsize / 100)}rem"
            style:line-height="{(DBState.db.lineHeight ?? 1.25) * (DBState.db.zoomsize / 100)}rem"
        >
            {#key `${totalLengthPointer}|${chatReloadPointer}`}
                <ChatBody
                    {character}
                    {firstMessage}
                    {idx}
                    {msgDisplay}
                    {name}
                    {bodyRoot}
                    renderRevision={chatBodyRevision}
                    modelShortName={
                        messageGenerationInfo ? getModelInfo(messageGenerationInfo?.model).shortName : ''
                    }
                    role={role ?? null}
                    bind:translated={translated}
                    bind:translating={translating}
                    bind:retranslate={retranslate}
                    {renderRawStreaming}
                    {deferAutoTranslate}
                    {translationHold}
                    {takeStartTranslated}
                    {surfaceEpoch}
                    {rawStreamingText} />
            {/key}
        </span>
        {#if interrupted && !isOptimizedStreamingMessage}
            <div class="text-xs text-textcolor2 italic interrupted-note" role="note">{language.messageInterrupted}</div>
        {/if}
        {#if renderFailed}
            <div class="text-xs text-textcolor2 italic render-failed-note" role="note">{language.messageRenderFailed}</div>
        {/if}
        {#if idx >= 0 && !editor.editMode && !editor.editTranslationMode && !isOptimizedStreamingMessage && partialEditEnabled && (DBState.db.enableBlockPartialEdit || DBState.db.enableDragPartialEdit)}
            <PartialEditController
                messageData={message}
                chatIndex={idx}
                {bodyRoot}
                blockEditEnabled={DBState.db.enableBlockPartialEdit}
                dragEditEnabled={DBState.db.enableDragPartialEdit}
                translatedView={translated}
                getTranslationEditContext={getTranslationPartialEditContext}
                on:save={handlePartialEditSave}
            />
        {/if}
    {/if}
{/snippet}

{#snippet iconButtons(options:{applyTextColors?:boolean} = {})}
    <div class="grow flex flex-wrap items-center justify-end" class:text-textcolor2={options?.applyTextColors !== false}>
        {#if isComment}
            <button
                class="flex items-center hover:text-blue-500 transition-colors button-icon-remove"
                onclick={async (e) => {
                    await rm(e, true)
                }}
            >
                <TrashIcon size={20} />

            </button>
        {:else}
            <span class="text-xs" aria-live="polite">{statusMessage}</span>
            <div class="flex items-center ml-2 gap-2">
                {@render translationButton()}
                {#if viewportWidthThisTask() >= 640}
                    {@render majorIconButtonsBody(false)}
                    {#if DBState.db.characters[selIdState.selId] && popupHasItems(false)}
                        <PopupButton>
                            {@render minorIconButtonsBody(true)}
                        </PopupButton>
                    {/if}
                {:else}
                    {#if DBState.db.characters[selIdState.selId]}
                        {#if popupHasItems(true)}
                            <PopupButton>
                                {@render majorIconButtonsBody(true)}
                                {@render minorIconButtonsBody(true)}
                            </PopupButton>
                        {/if}
                    {:else}
                        {@render majorIconButtonsBody(false)}
                    {/if}
                {/if}
                {@render rerolls()}

            </div>
            {#if endCount > 0}
                <div class="w-full flex justify-end mt-1 button-end-control-row">
                    <button class="flex items-center gap-1 enabled:hover:text-blue-500 disabled:opacity-40 transition-colors button-icon-end-control" disabled={treeBusy} onclick={() => onStep?.(liveLength, expectedId, 'back')}>
                        <ArrowLeftToLine size={20}/>
                        {#if DBState.db.swipe}
                            <span class="text-xs text-textcolor2">{endCount}</span>
                        {/if}
                    </button>
                </div>
            {/if}
        {/if}
    </div>
{/snippet}


{#snippet majorIconButtonsBody(showNames:boolean)}
    {#if copyButtonShown()}
    <button class="flex items-center hover:text-blue-500 transition-colors button-icon-copy" onclick={()=>{
        copyMessageText(currentCopyText(), reportCopy)
    }}>
        <CopyIcon size={20}/>
        {#if showNames}
            <span class="ml-1">{language.copy}</span>
        {/if}
    </button>    
{/if}
{#if speakerButtonShown()}
    <button class="flex items-center hover:text-blue-500 transition-colors button-icon-tts" onclick={()=>{
        return playMessageTTS(translated, bodyRoot, currentCopyText(), getCurrentCharacter())
    }}>
        <Volume2Icon size={20}/>
        {#if showNames}
            <span class="ml-1">TTS</span>
        {/if}
    </button>
{/if}
{#if idx > -1}
    <button class="flex items-center hover:text-blue-500 transition-colors button-icon-remove select-none [-webkit-touch-callout:none]" onclick={(e) => rm(e, false)} use:longpress={{callback: (e) => rm(e, true), touch: true}}>
        <TrashIcon size={20}/>

        {#if showNames}
            <span class="ml-1">{language.remove}</span>
        {/if}
    </button>
{/if}
{/snippet}

{#snippet translationButton(showNames = false)}
    {#if DBState.db.translator !== '' && !blankMessage && !isOptimizedStreamingMessage}
        <button
            class={"flex items-center transition-colors button-icon-translate " + (editor.translationViewControlsDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:text-blue-500') + (translated ? ' text-blue-400' : '')}
            class:translating={translating}
            disabled={editor.translationViewControlsDisabled}
            onclick={toggleTranslation}
        >
            <LanguagesIcon />
            {#if showNames}
                <span class="ml-1">{language.translate}</span>
            {/if}
        </button>
    {/if}
    {#if idx > -1 && !isOptimizedStreamingMessage}
        <button
            class={"flex items-center transition-colors button-icon-edit " + (editor.editMode ? 'text-blue-400 hover:text-blue-500' : editor.originalEditControlDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:text-blue-500')}
            disabled={editor.originalEditControlDisabled}
            onclick={editor.toggleOriginalEdit}
        >
            <PencilIcon size={20}/>

            {#if showNames}
                <span class="ml-1">{language.edit}</span>
            {/if}
        </button>
    {/if}
{/snippet}

{#snippet treeRerolls()}
    {#if DBState.db.swipe}
        {#if isLastRow || siblingCount > 1}
            <button class="flex items-center enabled:hover:text-blue-500 disabled:opacity-40 transition-colors button-icon-unreroll" disabled={treeBusy || siblingIndex <= 1} onclick={() => onStep?.(idx, expectedId, 'back')}>
                <ArrowLeft size={22}/>
            </button>
            {#if siblingCount > 1}
                <span class="flex items-center text-xs text-textcolor2">{siblingIndex}/{siblingCount}</span>
            {/if}
            <button class="flex items-center enabled:hover:text-blue-500 disabled:opacity-40 transition-colors button-icon-reroll" class:text-draculared={willGenerate} data-generates={willGenerate ? 'true' : undefined} disabled={treeBusy || (siblingIndex >= siblingCount && !willGenerate)} onclick={() => onStep?.(idx, expectedId, 'forward')}>
                <ArrowRight size={22}/>
            </button>
        {/if}
    {:else}
        {#if siblingCount > 1}
            <button class="flex items-center enabled:hover:text-blue-500 disabled:opacity-40 transition-colors button-icon-unreroll" disabled={treeBusy || siblingIndex <= 1} onclick={() => onStep?.(idx, expectedId, 'back')}>
                <ArrowLeft size={22}/>
            </button>
        {/if}
        {#if isLastRow}
            <button class="flex items-center enabled:hover:text-blue-500 disabled:opacity-40 transition-colors button-icon-reroll" class:text-draculared={willGenerate} data-generates={willGenerate ? 'true' : undefined} disabled={treeBusy || (siblingIndex >= siblingCount && !willGenerate)} onclick={() => onStep?.(idx, expectedId, 'forward')}>
                <RefreshCcwIcon size={20}/>
            </button>
        {:else if siblingCount > 1}
            <button class="flex items-center enabled:hover:text-blue-500 disabled:opacity-40 transition-colors button-icon-reroll" disabled={treeBusy || siblingIndex >= siblingCount} onclick={() => onStep?.(idx, expectedId, 'forward')}>
                <ArrowRight size={22}/>
            </button>
        {/if}
    {/if}
{/snippet}

{#snippet rerolls()}
    {#if treeControls}
        {@render treeRerolls()}
    {:else if rerollIcon || altGreeting}
        {#if DBState.db.swipe || altGreeting}
            <button class="flex items-center hover:text-blue-500 transition-colors button-icon-unreroll" class:dyna-icon={rerollIcon === 'dynamic'} onclick={unReroll}>
                <ArrowLeft size={22}/>
            </button>
            {#if firstMessage && DBState.db.swipe && DBState.db.showFirstMessagePages}
                <span class="flex items-center text-xs text-textcolor2">{currentPage}/{totalPages}</span>
            {/if}
            <button class="flex items-center hover:text-blue-500 transition-colors button-icon-reroll" class:dyna-icon={rerollIcon === 'dynamic'} onclick={onReroll}>
                <ArrowRight size={22}/>
            </button>
        {:else}
            <button class="flex items-center hover:text-blue-500 transition-colors button-icon-reroll" class:dyna-icon={rerollIcon === 'dynamic'} onclick={onReroll}>
                <RefreshCcwIcon size={20}/>
            </button>
        {/if}
    {/if}
{/snippet}

{#snippet minorIconButtonsBody(showNames:boolean)}
    {#if idx > -1}
    {#if DBState.db.enableBookmark}
        <button class="flex items-center hover:text-blue-500 transition-colors button-icon-bookmark {isBookmarked ? 'text-yellow-400' : ''}" onclick={async () => {
            await sleep(1)
            toggleBookmark()
        }}>
            <BookmarkIcon size={20}/>
            {#if showNames}
                <span class="ml-1">{language.bookmark}</span>
            {/if}
        </button>
    {/if}

    <button class="flex items-center enabled:hover:text-blue-500 disabled:opacity-40 transition-colors button-icon-branch" disabled={onBranch === undefined || branchDisabled} onclick={async () => {
        await branchMessage(() => idx, expectedId, onBranch)
    }}>
        <SplitIcon size={20}/>
        {#if showNames}
            <span class="ml-1">{language.branch}</span>
        {/if}
    </button>

    <button class="flex items-center hover:text-blue-500 transition-colors" onclick={async () => {
        await toggleMessageDisabled(() => idx, 'one')
    }}>
        <PowerOff size={20}/>
        {#if showNames}
            <span class="ml-1">{language.disableMessage}</span>
        {/if}
    </button>

    <button class="flex items-center hover:text-blue-500 transition-colors" onclick={async () => {
        await toggleMessageDisabled(() => idx, 'above')
    }}>
        <Scissors size={20}/>
        {#if showNames}
            <span class="ml-1">{language.disableAbove}</span>
        {/if}
    </button>
    {/if}

    {#if copyAsCardShown()}
        <button class="flex items-center hover:text-blue-500 transition-colors button-icon-copy-card" onclick={copyAsCard}>
            <IdCardIcon size={20}/>
            {#if showNames}
                <span class="ml-1">{language.copyAsCard}</span>
            {/if}
        </button>
    {/if}
{/snippet}

{#snippet senderIcon(options:{rounded?:boolean,styleFix?:string} = {})}
    {#if !blankMessage && !$HideIconStore}
        {#if DBState.db.characters[selIdState.selId]?.chaId === "§playground"}
        <div class="shadow-lg border-textcolor2 border flex justify-center items-center text-textcolor2" style={options?.styleFix ?? `height:${DBState.db.iconsize * 3.5 / 100}rem;width:${DBState.db.iconsize * 3.5 / 100}rem;min-width:${DBState.db.iconsize * 3.5 / 100}rem`}
            class:rounded-md={options?.rounded} class:rounded-full={options?.rounded}>
                {#if name === 'assistant'}
                    <BotIcon />
                {:else}
                    <UserIcon />
                {/if}
            </div>
        {:else}
            {#if iconMounted}
            {#await img}
                <div class="shadow-lg bg-textcolor2" style={options?.styleFix ??`height:${DBState.db.iconsize * 3.5 / 100}rem;width:${DBState.db.iconsize * 3.5 / 100}rem;min-width:${DBState.db.iconsize * 3.5 / 100}rem`}
                class:rounded-md={!options?.rounded} class:rounded-full={options?.rounded}></div>
            {:then m}
                {#if largePortrait && (!options?.rounded)}
                    <div class="shadow-lg bg-textcolor2" style={m + (options?.styleFix ?? `height:${DBState.db.iconsize * 3.5 / 100 / 0.75}rem;width:${DBState.db.iconsize * 3.5 / 100}rem;min-width:${DBState.db.iconsize * 3.5 / 100}rem`)}
                    class:rounded-md={!options?.rounded} class:rounded-full={options?.rounded}></div>
                {:else}
                    <div class="shadow-lg bg-textcolor2" style={m + (options?.styleFix ?? `height:${DBState.db.iconsize * 3.5 / 100}rem;width:${DBState.db.iconsize * 3.5 / 100}rem;min-width:${DBState.db.iconsize * 3.5 / 100}rem`)}
                    class:rounded-md={!options?.rounded} class:rounded-full={options?.rounded}></div>
                {/if}
            {:catch}
                <div class="shadow-lg bg-textcolor2" style={options?.styleFix ??`height:${DBState.db.iconsize * 3.5 / 100}rem;width:${DBState.db.iconsize * 3.5 / 100}rem;min-width:${DBState.db.iconsize * 3.5 / 100}rem`}
                class:rounded-md={!options?.rounded} class:rounded-full={options?.rounded}></div>
            {/await}
            {:else}
                <div class="shadow-lg bg-textcolor2" style={options?.styleFix ??`height:${DBState.db.iconsize * 3.5 / 100}rem;width:${DBState.db.iconsize * 3.5 / 100}rem;min-width:${DBState.db.iconsize * 3.5 / 100}rem`}
                class:rounded-md={!options?.rounded} class:rounded-full={options?.rounded}></div>
            {/if}
        {/if}
    {/if}
{/snippet}

{#snippet renderGuiHtmlPart(dom:HTMLElement)}
    {#if dom.tagName === 'IMG'}
        <img class={dom.getAttribute('class') ?? ''} alt="" style={dom.getAttribute('style') ?? ''} />
    {:else if dom.tagName === 'A'}
        <a target="_blank" rel="noreferrer" href={
            (dom.getAttribute('href') && dom.getAttribute('href').startsWith('https')) ? dom.getAttribute('href') : ''
        } class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
            {@render renderChilds(dom)}
        </a>
    {:else if dom.tagName === 'SPAN'}
        <span class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
            {@render renderChilds(dom)}
        </span>
    {:else if dom.tagName === 'DIV'}
        <div class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
            {@render renderChilds(dom)}
        </div>
    {:else if dom.tagName === 'P'}
        <p class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
            {@render renderChilds(dom)}
        </p>
    {:else if dom.tagName === 'H1'}
        <h1 class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
            {@render renderChilds(dom)}
        </h1>
    {:else if dom.tagName === 'H2'}
        <h2 class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
            {@render renderChilds(dom)}
        </h2>
    {:else if dom.tagName === 'H3'}
        <h3 class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
            {@render renderChilds(dom)}
        </h3>
    {:else if dom.tagName === 'H4'}
        <h4 class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
            {@render renderChilds(dom)}
        </h4>
    {:else if dom.tagName === 'H5'}
        <h5 class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
            {@render renderChilds(dom)}
        </h5>
    {:else if dom.tagName === 'H6'}
        <h6 class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
            {@render renderChilds(dom)}
        </h6>
    {:else if dom.tagName === 'UL'}
        <ul class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
            {@render renderChilds(dom)}
        </ul>
    {:else if dom.tagName === 'OL'}
        <ol class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
            {@render renderChilds(dom)}
        </ol>
    {:else if dom.tagName === 'LI'}
        <li class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
            {@render renderChilds(dom)}
        </li>
    {:else if dom.tagName === 'TABLE'}
        <table class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
            {@render renderChilds(dom)}
        </table>
    {:else if dom.tagName === 'TR'}
        <tr class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
            {@render renderChilds(dom)}
        </tr>
    {:else if dom.tagName === 'TD'}
        <td class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
            {@render renderChilds(dom)}
        </td>
    {:else if dom.tagName === 'TH'}
        <th class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
            {@render renderChilds(dom)}
        </th>
    {:else if dom.tagName === 'HR'}
        <hr class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''} />
    {:else if dom.tagName === 'BR'}
        <br class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''} />
    {:else if dom.tagName === 'CODE'}
        <code class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
            {@render renderChilds(dom)}
        </code>
    {:else if dom.tagName === 'PRE'}
        <pre class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
            {@render renderChilds(dom)}
        </pre>
    {:else if dom.tagName === 'BLOCKQUOTE'}
        <blockquote class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
            {@render renderChilds(dom)}
        </blockquote>
    {:else if dom.tagName === 'EM'}
        <em class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
            {@render renderChilds(dom)}
        </em>
    {:else if dom.tagName === 'STRONG'}
        <strong class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
            {@render renderChilds(dom)}
        </strong>
    {:else if dom.tagName === 'U'}
        <u class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
            {@render renderChilds(dom)}
        </u>
    {:else if dom.tagName === 'DEL'}
        <del class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
            {@render renderChilds(dom)}
        </del>
    {:else if dom.tagName === 'BUTTON'}
        <button class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
            {@render renderChilds(dom)}
        </button>
    {:else if dom.tagName === 'RISUTEXTBOX'}
        {@render textBox()}
    {:else if dom.tagName === 'RISUICON'}
        {@render senderIcon()}
    {:else if dom.tagName === 'RISUBUTTONS'}
        {@render iconButtons()}
    {:else if dom.tagName === 'RISUGENINFO'}
        {@render genInfo()}
    {:else if dom.tagName === 'STYLE'}
        <svelte:element this={'style'}>
            {dom.innerHTML}
        </svelte:element>
    {:else}
        <div class={dom.getAttribute('class') ?? ''} style={dom.getAttribute('style') ?? ''}>
            {@render renderChilds(dom)}
        </div>
    {/if}

    
{/snippet}

{#snippet renderChilds(dom:HTMLElement)}
    {#each dom.childNodes as node}
        {#if node.nodeType === Node.TEXT_NODE}
            {node.textContent}
        {:else if node.nodeType === Node.ELEMENT_NODE}
            {@render renderGuiHtmlPart((node as HTMLElement))}
        {/if}
    {/each}
{/snippet}


{#if disabled === true}
<div class="w-full border-t-2 border-dashed border-blue-500"></div>
{/if}
<div class="flex max-w-full justify-center risu-chat"
     data-chat-index={idx}
     data-chat-id={rootChatId}
     use:registerMessageRoot={{ index: idx, chatId: rootChatId }}
     style={isLastMemory ? `border-top:${DBState.db.memoryLimitThickness}px solid rgba(98, 114, 164, 0.7);` : ''}
     onclickcapture={handleButtonTriggerWithin}
     onsubmitcapture={handleFormTriggerWithin}>
    <div class="text-textcolor mt-1 ml-4 mr-4 mb-1 p-2 bg-transparent grow border-t-gray-900 border-opacity/30 border-transparent flexium items-start max-w-full" >
        {#if DBState.db.theme === 'mobilechat' && !blankMessage}
            <div class={role === 'user' ? "flex items-start w-full justify-end" : "flex items-start"}>
                {#if role !== 'user'}
                    {@render senderIcon({rounded: true})}
                {/if}
                <div
                    class="bg-gray-100 rounded-lg p-3 max-w-[70%] mx-2"
                    class:rounded-tl-none={role !== 'user'}
                    class:rounded-tr-none={role === 'user'}
                    style={LIGHT_SURFACE_STYLE}
                >
                    <p class="text-gray-800">{@render textBox()}</p>
                    {#if editor.editMode}
                        <div class="flex justify-end gap-2 mt-2">
                            <button
                                type="button"
                                class="rounded-md border border-gray-400 px-3 py-1 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-300/60 disabled:opacity-50 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-600"
                                disabled={editor.discardConfirmOpen}
                                onclick={editor.requestDiscardOriginalEdit}
                            >{language.messageEditDiscard}</button>
                            <button
                                type="button"
                                class="rounded-md bg-gray-800 px-3 py-1 text-sm font-medium text-gray-100 transition-colors hover:bg-gray-700 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-600"
                                onclick={editor.toggleOriginalEdit}
                            >{language.messageEditSave}</button>
                        </div>
                    {/if}
                    {#if DBState.db.characters?.[selIdState.selId]?.chats?.[DBState.db.characters?.[selIdState.selId]?.chatPage]?.message?.[idx]?.time}
                        <span class="text-xs text-gray-600 mt-1 block">
                            {new Intl.DateTimeFormat(undefined, {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                                month: '2-digit',
                                day: '2-digit',
                                hour12: false
                            }).format(DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage].message[idx].time)}
                        </span>
                    {/if}
                </div>
                {#if role === 'user'}
                    {@render senderIcon({rounded: true})}
                {/if}
            </div>
        {:else if DBState.db.theme === 'cardboard' && !blankMessage}
            <div class="w-full flex flex-col px-0 sm:px-4 py-4 relative">
                <div class="bg-linear-to-b from-gray-100 to-gray-200 rounded-lg shadow-lg border-gray-400 border p-4 flex flex-col">
                    <div class="flex gap-4 mt-2 flex-col sm:flex-row">
                        <div class="flex flex-col items-center">
                            <div class="sm:h-96 sm:w-72 sm:min-w-72 w-48 h-64">
                                {@render senderIcon({rounded: false, styleFix:'height:100%;width:100%;'})}
                            </div>
                            <h2 class="text-base font-bold text-gray-500 text-center mt-2 max-w-full text-ellipsis">{name}</h2>

                        </div>
                        {#if editor.editMode}
                            <!--
                              This wrapper carries the fixed height
                              (h-138/sm:h-96), not the textarea, so the
                              card's outer size is the same whether or not
                              the marker is showing. `min-h-0` lets the
                              textarea shrink to fill whatever height the
                              marker leaves within that fixed wrapper.
                            -->
                            <div class="grow h-138 sm:h-96 flex flex-col">
                                {#if editor.restoredMessageRecord}
                                    {@render draftRestoreMarker(editor.restoredMessageRecord, editor.revertOriginalEdit, true)}
                                {/if}
                                <textarea class="grow min-h-0 overflow-y-auto bg-transparent text-black p-2 mb-2 resize-none message-edit-area" bind:value={editor.editBuffer} oninput={(e) => editor.captureMessageEdit((e.currentTarget as HTMLTextAreaElement).value)}></textarea>
                            </div>
                        {:else}
                            <div class="grow h-138 sm:h-96 overflow-y-auto p-2 mb-2 sm:mb-0" style={LIGHT_SURFACE_STYLE}>
                                {@render textBox()}
                            </div>
                        {/if}
                    </div>
                </div>
                <div class="absolute bottom-0 right-0 bg-linear-to-b from-gray-200 to-gray-300 p-2 rounded-md border border-gray-400 text-gray-400">
                    {@render iconButtons({applyTextColors: false})}
                </div>
            </div>
        {:else if DBState.db.theme === 'customHTML' && !blankMessage}
            {@render renderGuiHtmlPart(RenderGUIHtml(DBState.db.guiHTML))}
        {:else}
            {@render senderIcon({rounded: DBState.db.roundIcons})}
            <span class="flex flex-col ml-4 w-full max-w-full min-w-0 text-black">
                <div class="flexium items-center chat-width">
                    {#if DBState.db.characters[selIdState.selId]?.chaId === "§playground" && !blankMessage && DBState.db.characters[selIdState.selId]?.chats?.[DBState.db.characters[selIdState.selId]?.chatPage]?.message?.[idx]}
                        <span class="chat-width text-xl border-darkborderc flex items-center text-textcolor">
                            <span>{DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage].message[idx].role === 'char' ? language.uiCommon.assistant : language.user}</span>
                            <button class="ml-2 text-textcolor2 hover:text-textcolor" onclick={() => {
                                DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage].message[idx].role = DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage].message[idx].role === 'char' ? 'user' : 'char'
                                ReloadChatPointer.update((v) => {
                                    v[idx] = (v[idx] ?? 0) + 1
                                    return v
                                })
                            }}><ArrowLeftRightIcon size="18" /></button>
                        </span>
                    {:else if !blankMessage && !$HideIconStore}
                        <div class="chat-width text-xl unmargin text-textcolor flex items-center">
                            <span>{name}</span>
                        </div>
                    {/if}
                    {@render iconButtons()}
                </div>
                {@render genInfo()}
                {@render textBox()}
            </span>
        {/if}
    </div>
</div>

{#if disabled}
<div class={{
    "w-full border-t-2 border-dashed": true,
    "border-blue-500": disabled === true,
    "border-amber-500": disabled === 'allBefore',
}}></div>
{/if}
