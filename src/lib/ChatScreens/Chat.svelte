<script lang="ts">
    import { ArrowLeft, ArrowLeftRightIcon, ArrowRight, BookmarkIcon, BotIcon, CopyIcon, IdCardIcon, PowerOff, GitBranch, HamburgerIcon, History, LanguagesIcon, MenuIcon, PencilIcon, RefreshCcwIcon, RotateCcw, SplitIcon, TrashIcon, UserIcon, Volume2Icon, Scissors } from "@lucide/svelte"
    import { aiLawApplies, changeChatTo, foldChatToMessage, createChatCopyName, getFileSrc } from "src/ts/globalApi.svelte"
    import { copyPlainText, stripThoughtsForCopy, type CopyOutcome } from "src/ts/chatCopy"
    import { CARD_DEADLINE_MS, CARD_PENDING_MARGIN_MS, captureCardTheme, noteNewerPlainCopy, startCardCopy, type CardReport } from "src/ts/chatCard"
    import { ColorSchemeTypeStore } from "src/ts/gui/colorscheme"
    import { longpress } from "src/ts/gui/longtouch"
    import { LIGHT_SURFACE_STYLE } from "src/ts/gui/lightSurface"
    import { getModelInfo } from "src/ts/model/modellist"
    import { runLuaButtonTrigger } from 'src/ts/process/scriptings'
    import { risuChatParser } from "src/ts/process/scripts"
    import { runTrigger } from 'src/ts/process/triggers'
    import { beginWork, originStatus } from 'src/ts/process/chatOrigin'
    import { sayTTS } from "src/ts/process/tts"
    import { buildDisplayParseOptions } from "src/ts/process/displayParseOptions"
    import { isTTSVoiceMode } from "src/ts/process/ttsModes"
    import { DBState, ReloadChatPointer, CurrentTriggerIdStore, popupStore } from 'src/ts/stores.svelte'
    import { registerDraft, unregisterDraft } from "src/ts/localDrafts"
    import { draftContentOrphanGate } from "src/ts/draftContentOrphanGate"
    import { type MessageIdentity, type TranslationIdentity, type DraftRecord, isDraftRestore } from "src/ts/draftContents"
    import { formatDraftAge } from "src/ts/draftAge"
    import { chatWindowKey } from "src/ts/chatWindowPolicy"
    import { capitalize, getUserIcon, getUserName, sleep } from "src/ts/util"
    import { onDestroy, onMount } from "svelte"
    import { fade } from "svelte/transition"
    import { type Unsubscriber } from "svelte/store"
    import { v4 as uuidv4, v4 } from 'uuid'
    import { language } from "../../lang"
    import { alertConfirm, alertInput, alertRequestData, alertSelect } from "../../ts/alert"
    import { markCharacterForSave } from "../../ts/storage/characterSaveMarks"
    import { ParseMarkdown, type CbsConditions, type simpleCharacterArgument } from "../../ts/parser/parser.svelte"
    import { getCurrentCharacter, getCurrentChat, type MessageGenerationInfo, type StreamingDisplayOptimizationMode } from "../../ts/storage/database.svelte"
    import { selectedCharID } from "../../ts/stores.svelte"
    import { HideIconStore, ReloadGUIPointer, selIdState } from "../../ts/stores.svelte"
    import AutoresizeArea from "../UI/GUI/TextAreaResizable.svelte"
    import ChatBody from './ChatBody.svelte'
    import PopupButton from "../UI/PopupButton.svelte";
    import PartialEditController from './PartialEditController.svelte';
    import { getLLMCache, setLLMCache } from "../../ts/translator/translator"

    let translating = $state(false)
    let editMode = $state(false)
    let statusMessage:string = $state('')
    let retranslate = $state(false)
    let editTranslationMode = $state(false)
    let loadingTranslationEdit = $state(false)
    let editTranslationText = $state('')
    let editTranslationKey: string | null = null
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
    }: Props = $props();

    let msgDisplay = $state('')
    let translated = $state(false)
    let partialEditEnabled = $state(true)
    let translationViewControlsDisabled = $derived(editMode || editTranslationMode || loadingTranslationEdit)
    let originalEditControlDisabled = $derived(editTranslationMode || loadingTranslationEdit)
    let translationEditControlDisabled = $derived(editMode || loadingTranslationEdit)

    // Two independent drafts can be in flight in this component at once (the
    // original-message editor and the translation editor), so each gets its own
    // per-instance key -- an index- or id-derived key would collide across a
    // remount at the same index. Driven from `$effect` (not the handlers that flip
    // `editMode`/`editTranslationMode`) so every exit path is covered, including
    // `handleLongPress` clearing `editMode` with no commit call.
    const editDraftKey = v4()
    const translationEditDraftKey = v4()
    $effect(() => {
        if (editMode) {
            registerDraft(editDraftKey)
            return () => unregisterDraft(editDraftKey)
        }
    })
    $effect(() => {
        if (editTranslationMode) {
            registerDraft(translationEditDraftKey)
            return () => unregisterDraft(translationEditDraftKey)
        }
    })

    // The original-text editor's edit target. `editBuffer` -- not the
    // `$bindable` `message` prop -- is what both edit surfaces (`textBox()`'s
    // AutoresizeArea and the cardboard theme's raw textarea) bind to, so a
    // parent-driven prop reset (BookmarkList's own mechanism) can never
    // clobber in-progress text. The identity is snapshotted at open time into
    // `frozenMessageIdentity` and never re-derived from live props for the
    // buffer's lifetime -- unlike `selId`/`chatPage`, which `edit()` below
    // deliberately keeps reading live.
    let editBuffer = $state('')
    let frozenMessageIdentity: MessageIdentity | null = null
    let frozenBaseData = ''

    // MC-068: set only when the editor now open (or being typed in) was
    // seeded from a stored draft rather than from `message`/the cached
    // translation -- drives the restore marker's visibility on each surface.
    // `null` means "no marker", regardless of `editMode`/`editTranslationMode`.
    let restoredMessageRecord: DraftRecord | null = $state(null)
    let restoredTranslationRecord: DraftRecord | null = $state(null)

    // The translation editor's own identity/seed, frozen the same way as
    // `frozenMessageIdentity`/`frozenBaseData` above -- never re-derived from
    // live props for the buffer's lifetime. `frozenTranslationSeed` is the
    // cached translation `loadTranslationForEdit` seeded at open, which a
    // revert restores to (not `baseData`/the key, which for a `tr:` record is
    // the source text).
    let frozenTranslationIdentity: TranslationIdentity | null = null
    let frozenTranslationSeed = ''

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

    // Capture. Called from the original-text editor's `oninput` (never
    // from an `$effect` mirroring the buffer, and never on a programmatic
    // assignment such as open or revert -- only a real `input` event on the
    // textarea reaches this), with the value read directly off the DOM
    // element that fired the event. Writes into the content store under the
    // identity frozen at open time: a buffer that currently equals the base
    // text (`frozenBaseData`, the message text at open) has nothing worth
    // persisting and nothing to offer back on a later open, so the record is
    // deleted instead of written -- this is also what removes a record when
    // typing passes back through the base text mid-edit.
    function captureMessageEdit(text: string) {
        if (!frozenMessageIdentity) {
            return
        }
        const identity = frozenMessageIdentity
        if (text === frozenBaseData) {
            draftContentOrphanGate.delete(identity)
            return
        }
        draftContentOrphanGate.set(identity, text, frozenBaseData)
    }

    // Same capture, for the translation editor. The ground-truth comparison
    // is `frozenTranslationSeed` (the cached translation seeded at open), NOT
    // `baseData`/the key: a `tr:` record's `baseData` is categorically a
    // different string from any translation.
    function captureTranslationEdit(text: string) {
        if (!frozenTranslationIdentity) {
            return
        }
        const identity = frozenTranslationIdentity
        const baseData = identity.key
        if (text === frozenTranslationSeed) {
            draftContentOrphanGate.delete(identity)
            return
        }
        draftContentOrphanGate.set(identity, text, baseData)
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

    async function rm(e:MouseEvent | TouchEvent, rec?:boolean){
        if(e.shiftKey){
            let msg = DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage].message
            msg = msg.slice(0, idx)
            DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage].message = msg
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

        const confirmed = DBState.db.askRemoval ? await alertConfirm(language.removeChat) : true
        if(!confirmed){
            return
        }
        let removeFromHere = false
        if(DBState.db.instantRemove || rec){
            const choice = await alertSelect([
                language.removeOnlyThisMessage,
                language.cancel,
                language.removeThisAndFollowingMessages,
            ], language.removeMessageQuestion)
            if(choice === '2'){
                removeFromHere = true
            }
            else if(choice !== '0'){
                return
            }
        }

        if(!DBState.db.characters.includes(owner) || !owner.chats.includes(chat)){
            return
        }
        const at = chat.message.indexOf(target)
        if(at === -1){
            return
        }
        if(removeFromHere){
            chat.message.splice(at)
        }
        else{
            chat.message.splice(at, 1)
        }
        markCharacterForSave(owner.chaId)
    }

    async function edit(){
        // `selId`/`chatPage` are read live here, not frozen -- copy and
        // branch both `unshift` a new chat and `changeChatTo(0)` while
        // reusing this mounted instance, so a frozen `chatPage` would write
        // into whatever chat now sits at the old index instead of the one
        // the user is looking at.
        const newText = editBuffer
        message = newText
        DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage].message[idx].data = newText
        // The draft is committed -- cleared only on a deliberate exit.
        if (frozenMessageIdentity) {
            draftContentOrphanGate.delete(frozenMessageIdentity)
        }
        frozenMessageIdentity = null
        restoredMessageRecord = null
    }

    function startOriginalEdit() {
        if (originalEditControlDisabled) return
        // Snapshot the identity now and freeze it for the buffer's lifetime.
        const identity = currentMessageIdentity()
        frozenMessageIdentity = identity
        frozenBaseData = message
        // Seed from the draft only when its stored base text still matches;
        // `draftContentOrphanGate.get` deletes a mismatched record itself.
        const record = draftContentOrphanGate.get(identity, message)
        // MC-068's surfaced rule: a matching-base record only counts as a
        // restore when its text also differs from `message`. Capture
        // never writes such a record for a `msg:` identity in the first
        // place (its own equals-base branch deletes instead), so the
        // `delete` here is a defensive check against a state the running app
        // cannot currently produce, not a live path -- kept because the
        // read-time rule should hold regardless of how a record got here
        // (e.g. written directly, as some tests do).
        if (record && isDraftRestore(record, message)) {
            editBuffer = record.text
            restoredMessageRecord = record
        } else {
            if (record) {
                draftContentOrphanGate.delete(identity)
            }
            editBuffer = message
            restoredMessageRecord = null
        }
        editMode = true
    }

    function revertOriginalEdit() {
        // Replaces the buffer with the saved message text, deletes the
        // stored record, and hides the marker -- the editor stays open. This
        // is a programmatic assignment to `editBuffer`, not an `input`
        // event, so it does not itself go through `captureMessageEdit`.
        editBuffer = message
        if (frozenMessageIdentity) {
            draftContentOrphanGate.delete(frozenMessageIdentity)
        }
        restoredMessageRecord = null
    }

    function toggleOriginalEdit() {
        if (originalEditControlDisabled) return

        if (editMode) {
            editMode = false
            edit()
        } else {
            startOriginalEdit()
        }
    }

    // Deliberate exit without saving: the draft of `identity` is cleared rather
    // than left to resurface later.
    function discardOriginalEdit(identity: MessageIdentity | null) {
        editMode = false
        if (identity) {
            draftContentOrphanGate.delete(identity)
        }
        frozenMessageIdentity = null
        restoredMessageRecord = null
    }

    let discardConfirmOpen = $state(false)

    // Asks only when leaving would drop a change. The answer acts only if the
    // same edit session is still open, so it can never discard a newer one.
    async function requestDiscardOriginalEdit() {
        if (!editMode || discardConfirmOpen) return
        const identity = frozenMessageIdentity
        if (editBuffer !== frozenBaseData) {
            discardConfirmOpen = true
            let confirmed = false
            try {
                confirmed = await alertConfirm(language.messageEditDiscardConfirm)
            } finally {
                discardConfirmOpen = false
            }
            if (!confirmed || !editMode || frozenMessageIdentity !== identity) return
        }
        discardOriginalEdit(identity)
    }

    function toggleTranslation() {
        if (translationViewControlsDisabled) return
        translated = !translated
    }

    function requestRetranslation() {
        if (translationViewControlsDisabled) return
        retranslate = true
    }

    async function handlePartialEditSave(e: CustomEvent<{ newData: string; target: 'original' | 'translation'; translationKey?: string }>) {
        if (idx < 0) return

        if (e.detail.target === 'translation') {
            if (!e.detail.translationKey) return

            await updateTranslationCache(e.detail.translationKey, e.detail.newData)
            return
        }

        message = e.detail.newData
        DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage].message[idx].data = e.detail.newData
        displaya(e.detail.newData)
    }

    // Translation cache writes from this instance land in click order: each waits
    // for the previous one to settle, whether it succeeded or failed, and every
    // caller sees only its own outcome.
    let translationWriteChain: Promise<void> = Promise.resolve()

    // Translation saves clicked from this instance that have not settled yet.
    let pendingTranslationSaves = 0

    async function updateTranslationCache(key: string, data: string) {
        const write = translationWriteChain.then(() => setLLMCache(key, data))
        translationWriteChain = write.then(() => {}, () => {})
        await write
        chatBodyRevision += 1
    }

    async function getTranslationPartialEditContext() {
        if (!translated || DBState.db.translatorType !== 'llm') {
            return null
        }

        const key = await getTranslationCacheKey()
        if (!key) {
            return null
        }
        const data = await getLLMCache(key)
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

    async function getTranslationCacheKey(): Promise<string> {
        if(DBState.db.translateBeforeHTMLFormatting){
            return msgDisplay
        }
        if(!DBState.db.legacyTranslation){
            return await ParseMarkdown(msgDisplay, character, 'pretranslate', idx, getCbsCondition())
        }
        return await ParseMarkdown(msgDisplay, character, 'notrim', idx, getCbsCondition())
    }

    async function loadTranslationForEdit() {
        if (translationViewControlsDisabled) return

        loadingTranslationEdit = true
        try {
            const key = await getTranslationCacheKey()
            const cached = await getLLMCache(key)
            const seed = cached ?? ''
            editTranslationKey = key
            // Freeze the translation identity/seed now, for the buffer's
            // lifetime -- never re-derived from live props. `baseData` is the
            // same key string (the parsed source text the translation was
            // made from), not the cached translation.
            const identity: TranslationIdentity = { kind: 'tr', key }
            frozenTranslationIdentity = identity
            frozenTranslationSeed = seed
            const record = draftContentOrphanGate.get(identity, key)
            // MC-068 applied to the translation editor: the seed to compare
            // against is the cached translation, NOT `baseData` (which is the
            // source text/key and can never equal a translation). Unlike the
            // `msg:` case above, this delete IS reachable from the running
            // app: it fires whenever
            // the cached translation happens to equal the stored draft's
            // text -- for example a retranslate that produces that exact
            // text, or a partial-edit save on another message that shares
            // this cache key.
            if (record && isDraftRestore(record, seed)) {
                editTranslationText = record.text
                restoredTranslationRecord = record
            } else {
                if (record) {
                    draftContentOrphanGate.delete(identity)
                }
                editTranslationText = seed
                restoredTranslationRecord = null
            }
            editTranslationMode = true
        } catch (error) {
            editTranslationKey = null
            frozenTranslationIdentity = null
            throw error
        } finally {
            loadingTranslationEdit = false
        }
    }

    async function saveTranslationEdit() {
        if (editTranslationKey === null) return

        // Long-press SAVES on this editor, and shares this same function
        // with the Save button. The key, identity and text are taken at the click;
        // a rejection propagates unchanged and leaves the editor, buffer, identity
        // and record untouched.
        const key = editTranslationKey
        const identity = frozenTranslationIdentity
        const text = editTranslationText
        pendingTranslationSaves += 1
        try {
            await updateTranslationCache(key, text)
        } finally {
            pendingTranslationSaves -= 1
        }
        if (!identity) return

        // The `tr:key` record is shared by every instance and session for this
        // key, so a settle compares against the record itself: it deletes only a
        // record holding the text it wrote. Only the settle that leaves no save
        // from this instance pending may treat its text as final: while a later
        // save is in flight, a record can hold the user's newest text, and a
        // destroyed instance could never write it again.
        if (pendingTranslationSaves === 0 && draftContentOrphanGate.get(identity, identity.key)?.text === text) {
            draftContentOrphanGate.delete(identity)
        }

        // A destroyed instance, or one whose editor session differs from the
        // clicked one, changes nothing beyond the cache and the record delete above.
        if (destroyed || frozenTranslationIdentity !== identity || !editTranslationMode) return

        if (editTranslationText === text && pendingTranslationSaves === 0) {
            frozenTranslationIdentity = null
            restoredTranslationRecord = null
            editTranslationKey = null
            editTranslationMode = false
            return
        }

        // The editor stays open while the buffer differs from `text` or a later
        // save from this instance is still pending. The cache holds `text`, so
        // that is what Revert and "unchanged" compare against, and the buffer
        // gets a record only when none exists (an existing record keeps its
        // keystroke-time age) and the buffer differs from that seed.
        frozenTranslationSeed = text
        restoredTranslationRecord = null
        if (editTranslationText !== text && !draftContentOrphanGate.get(identity, identity.key)) {
            draftContentOrphanGate.set(identity, editTranslationText, identity.key)
        }
    }

    function revertTranslationEdit() {
        // Replaces the buffer with the cached translation seeded at open
        // (not `baseData`/the key), deletes the stored record, and
        // hides the marker -- the editor stays open. A programmatic
        // assignment to `editTranslationText`, not an `input` event, so it
        // does not itself go through `captureTranslationEdit`.
        editTranslationText = frozenTranslationSeed
        if (frozenTranslationIdentity) {
            draftContentOrphanGate.delete(frozenTranslationIdentity)
        }
        restoredTranslationRecord = null
    }

    function displayParseOptions(){
        const conditions = getCbsCondition()
        return buildDisplayParseOptions({chara: name, chatID: idx, firstmsg: conditions.firstmsg, chatRole: conditions.chatRole ?? null})
    }

    function displaya(message:string){
        msgDisplay = risuChatParser(message, displayParseOptions())
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
    const copyAsCard = ()=>{
        startCardCopy({
            owner: cardOwner,
            captureText: currentCopyText,
            captureCard: (copyText:string) => {
                const isUser = role === 'user'
                const character = getCurrentCharacter()
                const cbsConditions = getCbsCondition()
                const messageIdx = idx
                const root = document.documentElement
                return {
                    copyText,
                    displayName: isUser ? getUserName() : name,
                    badge: isUser ? null : (messageGenerationInfo ? capitalize(getModelInfo(messageGenerationInfo.model).shortName) : 'AI'),
                    avatarPath: (isUser ? getUserIcon() : DBState.db.characters[selIdState.selId]?.image) ?? '',
                    theme: captureCardTheme((property) => root.style.getPropertyValue(property)),
                    parseBody: () => ParseMarkdown(copyText, character, 'normal', messageIdx, cbsConditions),
                    resolveAvatarSrc: getFileSrc,
                }
            },
            report: reportCard,
        })
    }


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

    $effect.pre(() => {
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
            updateDisplayedMessage()
        }))
    })

    onDestroy(()=>{
        destroyed = true
        clearTimeout(statusTimer)
        unsubscribers.forEach(u => u())
        // Backstop alongside the `$effect` cleanups above -- `unregisterDraft` is a
        // safe no-op if the key was already removed.
        unregisterDraft(editDraftKey)
        unregisterDraft(translationEditDraftKey)
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

    async function handleButtonTriggerWithin(event: UIEvent) {
        const currentChar = getCurrentCharacter()
        if(!currentChar || currentChar.type === 'group'){
            return
        }

        const target = event.target as HTMLElement
        const origin = target.closest('[risu-trigger], [risu-btn]')
        if (!origin) {
            return
        }

        const triggerName = origin.getAttribute('risu-trigger')
        const triggerId = origin.getAttribute('risu-id')
        const btnEvent = origin.getAttribute('risu-btn')

        const currentChat = getCurrentChat()
        // Aborted only by a delete of the chat this run writes to: the registration's
        // stop is the run's one cancel path, and the busy button does not reach it.
        const runController = new AbortController()
        const workHandle = beginWork(currentChar, currentChat, undefined, () => runController.abort())
        if (!workHandle) {
            return
        }

        let triggerResult
        try {
            triggerResult =
                triggerName ?
                    await runTrigger(currentChar, 'manual', {
                        chat: currentChat,
                        manualName: triggerName,
                        triggerId: triggerId || undefined,
                        origin: workHandle.origin,
                        signal: runController.signal,
                    }) :
                btnEvent ?
                    await runLuaButtonTrigger(currentChar, btnEvent, workHandle.origin) :
                null
        } finally {
            workHandle.end()
        }

        // A gone origin skips the reload bump; an ambiguous one still gets
        // it whenever a trigger ran, since its chat is still on screen.
        if(triggerResult && originStatus(workHandle.origin) !== 'gone') {
            ReloadChatPointer.update((v) => {
                v[idx] = (v[idx] ?? 0) + 1
                return v
            })
        }
        
        if(triggerName && triggerId) {
            setTimeout(() => {
                CurrentTriggerIdStore.set(null)
            }, 100) // Small delay to allow display mode to complete
        }
    }

    let isBookmarked = $derived(
        DBState.db.characters[selIdState.selId]
            ?.chats[DBState.db.characters[selIdState.selId].chatPage]
            ?.bookmarks?.includes(DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage].message[idx]?.chatId) ?? false
    );

    async function toggleBookmark() {
        const chat = DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage];
        
        if(!chat.message[idx]) return;

        let messageId = chat.message[idx]?.chatId;
        const messageContent = chat.message[idx]?.data;

        if (!messageId) {
            messageId = uuidv4();
            chat.message[idx].chatId = messageId;
        }

        chat.bookmarks ??= [];
        chat.bookmarkNames ??= {};

        const bookmarkIndex = chat.bookmarks.indexOf(messageId);

        if (bookmarkIndex > -1) {
            chat.bookmarks.splice(bookmarkIndex, 1);
            delete chat.bookmarkNames[messageId];
        } else {
            chat.bookmarks.push(messageId);

            const msgSender = chat.message[idx]?.role === 'user' ? getUserName() : name;
            const newName= await alertInput(language.bookmarkAskNameOrDefault, [], chat.bookmarkNames[messageId] || '');

            if (newName && newName.trim() !== '') {
                chat.bookmarkNames[messageId] = newName;
            } else {
                let defaultName;

                const blacklist = ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '_', '+', '-', '=', '[', ']', '{', '}', '|', ';', ':', '"', "'", ',', '.', '<', '>', '/', '?'];
                let lines = messageContent.split('\n');
                lines = lines.splice(Math.floor(lines.length * 0.5));
                for (const line of lines) {
                    if (line && !blacklist.some(char => line.startsWith(char))) {
                        defaultName = line.trim().slice(0, 50) + '...';
                        break;
                    }
                }
                if (!defaultName) {
                    defaultName = messageContent.slice(0, 50) + '...';
                }
                chat.bookmarkNames[messageId] = msgSender + '| ' + defaultName;
            }
        }

        chat.bookmarks = [...chat.bookmarks];
    }
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
            <button class={"text-sm p-1 text-textcolor2 border-darkborderc float-end mr-2 my-1 rounded-md transition-all flex justify-center items-center " + (translationViewControlsDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:ring-darkbutton hover:ring-3 hover:text-textcolor')}
                    disabled={translationViewControlsDisabled}
                    onclick={requestRetranslation}
            >
                <RefreshCcwIcon size={20} />
                <span class="ml-1">
                    {language.retranslate}
                </span>
            </button>
            <button class={"text-sm p-1 border-darkborderc float-end mr-2 my-1 rounded-md transition-all flex justify-center items-center " + (editTranslationMode ? 'text-blue-400 hover:ring-darkbutton hover:ring-3 hover:text-textcolor' : translationEditControlDisabled ? 'text-textcolor2 opacity-50 cursor-not-allowed' : 'text-textcolor2 hover:ring-darkbutton hover:ring-3 hover:text-textcolor')}
                    disabled={translationEditControlDisabled}
                    onclick={() => {
                        if(editTranslationMode){
                            saveTranslationEdit()
                        } else {
                            loadTranslationForEdit()
                        }
                    }}
            >
                <PencilIcon size={20} />
                <span class="ml-1">
                    {editTranslationMode ? language.editTranslationSave : language.editTranslation}
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
    {#if editTranslationMode}
        {#if restoredTranslationRecord}
            {@render draftRestoreMarker(restoredTranslationRecord, revertTranslationEdit, markerOnLightSurface)}
        {/if}
        <AutoresizeArea bind:value={editTranslationText} onUserEdit={captureTranslationEdit} handleLongPress={() => {
            saveTranslationEdit()
        }} />
    {/if}
    {#if editMode}
        {#if restoredMessageRecord}
            {@render draftRestoreMarker(restoredMessageRecord, revertOriginalEdit, markerOnLightSurface)}
        {/if}
        <AutoresizeArea bind:value={editBuffer} onUserEdit={captureMessageEdit} lightSurface={DBState.db.theme === 'mobilechat'} handleLongPress={() => {
            // Mouse long-press on the original-text editor discards without asking.
            discardOriginalEdit(frozenMessageIdentity)
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
        {@const chatReloadPointer = $ReloadGUIPointer + ($ReloadChatPointer[idx] ?? 0)}
        {@const totalLengthPointer = (idx > totalLength - 6) ? totalLength : 0}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span class="text chat-width chattext prose minw-0"
            class:hidden={editTranslationMode}
            class:prose-invert={$ColorSchemeTypeStore && !markerOnLightSurface}
            bind:this={bodyRoot}
            onclick={() => {
            if(DBState.db.clickToEdit && idx > -1 && !isOptimizedStreamingMessage){
                startOriginalEdit()
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
                    {rawStreamingText} />
            {/key}
        </span>
        {#if idx >= 0 && !editMode && !editTranslationMode && !isOptimizedStreamingMessage && partialEditEnabled && (DBState.db.enableBlockPartialEdit || DBState.db.enableDragPartialEdit)}
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
    <div class="grow flex items-center justify-end" class:text-textcolor2={options?.applyTextColors !== false}>
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
                {#if window.innerWidth >= 640}
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
        {/if}
    </div>
{/snippet}


{#snippet majorIconButtonsBody(showNames:boolean)}
    {#if copyButtonShown()}
    <button class="flex items-center hover:text-blue-500 transition-colors button-icon-copy" onclick={()=>{
        const copyText = stripThoughtsForCopy(currentCopyText())
        copyPlainText(copyText, reportCopy)
        noteNewerPlainCopy(copyText, reportCopy)
    }}>
        <CopyIcon size={20}/>
        {#if showNames}
            <span class="ml-1">{language.copy}</span>
        {/if}
    </button>    
{/if}
{#if speakerButtonShown()}
    <button class="flex items-center hover:text-blue-500 transition-colors button-icon-tts" onclick={()=>{
        return sayTTS(null, stripThoughtsForCopy(currentCopyText()))
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
            class={"flex items-center transition-colors button-icon-translate " + (translationViewControlsDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:text-blue-500') + (translated ? ' text-blue-400' : '')}
            class:translating={translating}
            disabled={translationViewControlsDisabled}
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
            class={"flex items-center transition-colors button-icon-edit " + (editMode ? 'text-blue-400 hover:text-blue-500' : originalEditControlDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:text-blue-500')}
            disabled={originalEditControlDisabled}
            onclick={toggleOriginalEdit}
        >
            <PencilIcon size={20}/>

            {#if showNames}
                <span class="ml-1">{language.edit}</span>
            {/if}
        </button>
    {/if}
{/snippet}

{#snippet rerolls()}
    {#if rerollIcon || altGreeting}
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

    <button class="flex items-center hover:text-blue-500 transition-colors" onclick={async () => {
        await sleep(1)
        const currentChat = DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage]
        
        if(DBState.db.createFolderOnBranch && !currentChat.folderId){
            const folderId = v4()
            DBState.db.characters[selIdState.selId].chatFolders ??= []
            DBState.db.characters[selIdState.selId].chatFolders.unshift({
                id: folderId,
                name: `Branches of ${currentChat.name}`,
                folded: false,
            })
            currentChat.folderId = folderId
        }
        
        const currentMessage = currentChat.message[idx]
        const newChat = $state.snapshot(currentChat)
        newChat.name = createChatCopyName(newChat.name, 'Branch')
        newChat.id = v4()
        newChat.message = newChat.message.slice(0, idx + 1)
        newChat.message.push({
            role: 'char',
            data: '{{specialcomment::branchedfrom::' + currentChat.id + '::' + currentChat.name + '::' + currentMessage.chatId + '::}}',
            isComment: true,
            disabled: true,
            chatId: v4(),
        })

        DBState.db.characters[selIdState.selId].chats.unshift(newChat)
        changeChatTo(0)
    }}>
        <SplitIcon size={20}/>
        {#if showNames}
            <span class="ml-1">{language.branch}</span>
        {/if}
    </button>

    <button class="flex items-center hover:text-blue-500 transition-colors" onclick={async () => {
        await sleep(1)
        const currentMessage = DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage].message[idx]
        DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage].message[idx].disabled = !currentMessage.disabled
    }}>
        <PowerOff size={20}/>
        {#if showNames}
            <span class="ml-1">{language.disableMessage}</span>
        {/if}
    </button>

    <button class="flex items-center hover:text-blue-500 transition-colors" onclick={async () => {
        await sleep(1)
        const currentMessage = DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage].message[idx]
        DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage].message[idx].disabled = currentMessage.disabled === 'allBefore' ? false : 'allBefore'
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
     data-chat-id={DBState.db.characters?.[selIdState.selId]?.chats?.[DBState.db.characters?.[selIdState.selId]?.chatPage]?.message?.[idx]?.chatId ?? ''}
     style={isLastMemory ? `border-top:${DBState.db.memoryLimitThickness}px solid rgba(98, 114, 164, 0.7);` : ''}
     onclickcapture={handleButtonTriggerWithin}>
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
                    {#if editMode}
                        <div class="flex justify-end gap-2 mt-2">
                            <button
                                type="button"
                                class="rounded-md border border-gray-400 px-3 py-1 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-300/60 disabled:opacity-50 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-600"
                                disabled={discardConfirmOpen}
                                onclick={requestDiscardOriginalEdit}
                            >{language.messageEditDiscard}</button>
                            <button
                                type="button"
                                class="rounded-md bg-gray-800 px-3 py-1 text-sm font-medium text-gray-100 transition-colors hover:bg-gray-700 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-600"
                                onclick={toggleOriginalEdit}
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
                        {#if editMode}
                            <!--
                              This wrapper carries the fixed height
                              (h-138/sm:h-96), not the textarea, so the
                              card's outer size is the same whether or not
                              the marker is showing. `min-h-0` lets the
                              textarea shrink to fill whatever height the
                              marker leaves within that fixed wrapper.
                            -->
                            <div class="grow h-138 sm:h-96 flex flex-col">
                                {#if restoredMessageRecord}
                                    {@render draftRestoreMarker(restoredMessageRecord, revertOriginalEdit, true)}
                                {/if}
                                <textarea class="grow min-h-0 overflow-y-auto bg-transparent text-black p-2 mb-2 resize-none message-edit-area" bind:value={editBuffer} oninput={(e) => captureMessageEdit((e.currentTarget as HTMLTextAreaElement).value)}></textarea>
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
