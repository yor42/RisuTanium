import { v4 } from 'uuid'
import { DBState, selIdState } from '../stores.svelte'
import { registerDraft, unregisterDraft } from '../localDrafts'
import { draftContentOrphanGate } from '../draftContentOrphanGate'
import { type MessageIdentity, type TranslationIdentity, type DraftRecord, isDraftRestore } from '../draftContents'
import { MEASURE } from './memory/measureFlag'
import { noteEditConfirm } from './chatPhaseRing'
import { getLLMCache, setLLMCache } from '../translator/translator'
import { chatSurface } from '../../lib/ChatScreens/chatSurface.svelte'
import { alertConfirm } from '../alert'
import { language } from '../../lang'
import type { Message } from '../storage/database.svelte'

export interface TranslationOpenToken {
    identity: string
    row: Message | undefined
    data: string | undefined
    closeEpoch: number
}
export interface MessageEditorDeps {
    getMessage(): string
    setMessage(value: string): void
    getIdx(): number
    currentMessageIdentity(): MessageIdentity
    getTranslationCacheKey(): Promise<string | null>
    translationOpenToken(): TranslationOpenToken
    translationOpenCurrent(token: TranslationOpenToken): boolean
    isDestroyed(): boolean
    onTranslationCacheWritten(): void
}
let translationLoads = 0
export function translationEditLoading(): number {
    return translationLoads
}
export function createMessageEditorController(deps: MessageEditorDeps) {
    let editMode = $state(false)
    let editTranslationMode = $state(false)
    let loadingTranslationEdit = $state(false)
    let editTranslationText = $state('')
    let editTranslationKey: string | null = null
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

    // Opening Settings closes both editors without discarding anything: the stored
    // draft records stay in `draftContentOrphanGate` and are offered again on the next
    // open, and the registered-draft effects above release their registrations.
    let seenCloseEpoch = chatSurface.closeEpoch
    $effect(() => {
        const epoch = chatSurface.closeEpoch
        if (epoch === seenCloseEpoch) {
            return
        }
        seenCloseEpoch = epoch
        editMode = false
        editTranslationMode = false
        discardConfirmOpen = false
        frozenMessageIdentity = null
        frozenTranslationIdentity = null
        restoredMessageRecord = null
        restoredTranslationRecord = null
    })

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

    async function edit(){
        // `selId`/`chatPage` are read live here, not frozen -- copy
        // `unshift`s a new chat and `changeChatTo(0)` while reusing this
        // mounted instance, so a frozen `chatPage` would write into
        // whatever chat now sits at the old index instead of the one the
        // user is looking at.
        const newText = editBuffer
        deps.setMessage(newText)
        const edited = DBState.db.characters[selIdState.selId].chats[DBState.db.characters[selIdState.selId].chatPage].message[deps.getIdx()]
        edited.data = newText
        // Committing is a look at the text, changed or not.
        delete edited.interrupted
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
        const identity = deps.currentMessageIdentity()
        frozenMessageIdentity = identity
        frozenBaseData = deps.getMessage()
        // Seed from the draft only when its stored base text still matches;
        // `draftContentOrphanGate.get` deletes a mismatched record itself.
        const record = draftContentOrphanGate.get(identity, deps.getMessage())
        // MC-068's surfaced rule: a matching-base record only counts as a
        // restore when its text also differs from `message`. Capture
        // never writes such a record for a `msg:` identity in the first
        // place (its own equals-base branch deletes instead), so the
        // `delete` here is a defensive check against a state the running app
        // cannot currently produce, not a live path -- kept because the
        // read-time rule should hold regardless of how a record got here
        // (e.g. written directly, as some tests do).
        if (record && isDraftRestore(record, deps.getMessage())) {
            editBuffer = record.text
            restoredMessageRecord = record
        } else {
            if (record) {
                draftContentOrphanGate.delete(identity)
            }
            editBuffer = deps.getMessage()
            restoredMessageRecord = null
        }
        editMode = true
    }

    function revertOriginalEdit() {
        // Replaces the buffer with the saved message text, deletes the
        // stored record, and hides the marker -- the editor stays open. This
        // is a programmatic assignment to `editBuffer`, not an `input`
        // event, so it does not itself go through `captureMessageEdit`.
        editBuffer = deps.getMessage()
        if (frozenMessageIdentity) {
            draftContentOrphanGate.delete(frozenMessageIdentity)
        }
        restoredMessageRecord = null
    }

    function toggleOriginalEdit() {
        if (originalEditControlDisabled) return

        if (editMode) {
            const confirmStartT = MEASURE ? performance.now() : 0
            editMode = false
            edit()
            if (MEASURE) {
                noteEditConfirm(confirmStartT)
            }
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
        deps.onTranslationCacheWritten()
    }

    async function loadTranslationForEdit() {
        if (translationViewControlsDisabled) return

        loadingTranslationEdit = true
        translationLoads += 1
        try {
            const token = deps.translationOpenToken()
            const key = await deps.getTranslationCacheKey()
            if (key === null || !deps.translationOpenCurrent(token)) return
            const cached = await getLLMCache(key)
            if (!deps.translationOpenCurrent(token)) return
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
            translationLoads -= 1
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
        if (deps.isDestroyed() || frozenTranslationIdentity !== identity || !editTranslationMode) return

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

    function closeTranslationKeep() {
        editTranslationMode = false
        editTranslationKey = null
        frozenTranslationIdentity = null
        restoredTranslationRecord = null
    }
    function dispose() {
        unregisterDraft(editDraftKey)
        unregisterDraft(translationEditDraftKey)
    }
    return {
        get editMode() { return editMode },
        set editMode(value: boolean) { editMode = value },
        get editBuffer() { return editBuffer },
        set editBuffer(value: string) { editBuffer = value },
        get frozenMessageIdentity() { return frozenMessageIdentity },
        get frozenBaseData() { return frozenBaseData },
        get restoredMessageRecord() { return restoredMessageRecord },
        get discardConfirmOpen() { return discardConfirmOpen },
        get editTranslationMode() { return editTranslationMode },
        get editTranslationText() { return editTranslationText },
        set editTranslationText(value: string) { editTranslationText = value },
        get editTranslationKey() { return editTranslationKey },
        get loadingTranslationEdit() { return loadingTranslationEdit },
        get frozenTranslationIdentity() { return frozenTranslationIdentity },
        get frozenTranslationSeed() { return frozenTranslationSeed },
        get restoredTranslationRecord() { return restoredTranslationRecord },
        get pendingTranslationSaves() { return pendingTranslationSaves },
        get translationViewControlsDisabled() { return translationViewControlsDisabled },
        get originalEditControlDisabled() { return originalEditControlDisabled },
        get translationEditControlDisabled() { return translationEditControlDisabled },
        captureMessageEdit, captureTranslationEdit, edit, startOriginalEdit,
        revertOriginalEdit, toggleOriginalEdit, discardOriginalEdit,
        requestDiscardOriginalEdit, loadTranslationForEdit, saveTranslationEdit,
        revertTranslationEdit, updateTranslationCache, closeTranslationKeep, dispose,
    }
}
export type MessageEditorController = ReturnType<typeof createMessageEditorController>
export function closeTranslationKeep(controller: MessageEditorController): void {
    controller.closeTranslationKeep()
}
