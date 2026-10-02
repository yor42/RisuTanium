import { language } from "../../lang"
import type { Database, character, groupChat, Chat } from "../storage/database.svelte"
import type { SerializableHypaV2Data } from "./memory/hypav2"
import type { SerializableHypaV3Data } from "./memory/hypav3"

export const coldStorageHeader = '\uEF01COLDSTORAGE\uEF01'

const coldStorageLoadErrorPrefix = '[Cold storage data could not be loaded. Key: '
const coldStorageLoadErrorSuffix = ']'

/**
 * Builds the chat-message text that recorded a failed/unusable cold read.
 *
 * `preLoadChat` (`coldstorage.svelte.ts`) does not mutate the chat on a
 * failed read -- it resolves a failure result (`'error'`, `'unavailable'` or
 * `'damaged'`) and leaves the pointer in `chat.message[0].data` untouched, so
 * nothing is lost. An `'error'` can be retried by reopening the chat; a repeat
 * of an `'unavailable'` or `'damaged'` result cannot be expected to succeed, and the pointer
 * is left so the stored unit is still referenced. An older install (or
 * backup) can still hold a chat whose `message[0]` was overwritten with this
 * legacy error text instead.
 *
 * This builder has no production caller of its own. It is kept only as the
 * counterpart of `matchColdStorageLoadErrorKey` -- the two share the same
 * prefix/suffix constants so they cannot drift apart -- and is used by
 * tests to build a chat already holding this legacy text, standing in for
 * an install that hit a failed read under the old behaviour.
 * `listRecoverableErrorKeysFromDb` calls `matchColdStorageLoadErrorKey`
 * directly rather than this builder, and the chat-screen notice for a
 * failed read is chosen by `coldChatNoticeText` below from the
 * differently-worded, parameterised `language.errors` texts, not from this
 * text.
 */
export function formatColdStorageLoadError(coldDataKey: string): string {
    return `${coldStorageLoadErrorPrefix}${coldDataKey}${coldStorageLoadErrorSuffix}`
}

/**
 * True when `chat`'s first message is still a live cold-storage pointer --
 * i.e. `preLoadChat` has not yet restored it (or a read attempt failed and
 * left the pointer in place rather than overwriting it).
 * Used to block sending into a chat that has not finished loading
 * (CHORE-07).
 */
export function isColdChat(chat: Pick<Chat, 'message'> | null | undefined): boolean {
    const data = chat?.message?.[0]?.data
    return typeof data === 'string' && data.startsWith(coldStorageHeader)
}

/**
 * Recovers the key from text that exactly matches
 * `formatColdStorageLoadError`'s output, anchored on the whole string.
 * Returns null for anything else, including a near-miss with extra
 * prefix/suffix text around an otherwise-exact match -- the captured key
 * text itself is never rejected by its format.
 */
export function matchColdStorageLoadErrorKey(text: unknown): string | null {
    if (!text || typeof text !== 'string') {
        return null
    }
    if (!text.startsWith(coldStorageLoadErrorPrefix) || !text.endsWith(coldStorageLoadErrorSuffix)) {
        return null
    }
    return text.slice(coldStorageLoadErrorPrefix.length, text.length - coldStorageLoadErrorSuffix.length)
}

/**
 * Why a cold read that did not succeed cannot be expected to succeed by simply being repeated,
 * as `readColdStorageItem` (`coldstorage.svelte.ts`) reports it beside
 * `status: 'error'`:
 *   - `'unavailable'` -- this page offers no storage for archived data at all
 *                        (the browser has no `navigator.storage.getDirectory`).
 *   - `'damaged'`     -- the key cannot be a storage name, so nothing was
 *                        read, or the bytes were read but do not decode.
 * A read error with neither cause has no kind and stays a read that may work
 * later.
 */
export type ColdReadErrorKind = 'unavailable' | 'damaged'

/**
 * fflate 0.8.2 (`ec` table in `lib/node.cjs`) codes that say the compressed
 * input itself is bad: 0 unexpected EOF (a truncated stream), 1 invalid block
 * type, 2 invalid length/literal, 3 invalid distance, 6 invalid zlib or gzip
 * data. The remaining codes (4, 5 and 7 and up) mean the API was misused or
 * concern archive entries, so they say nothing about stored bytes.
 */
const fflateDataFormatCodes: ReadonlySet<number> = new Set([0, 1, 2, 3, 6])

/**
 * `'damaged'` when `error`, thrown by the decompress step, carries a numeric
 * fflate data-format code. Every other failure of that step (a buffer that
 * cannot be allocated, a Worker that cannot start, an fflate API-misuse code,
 * an error with no code, a `SyntaxError`-named error from starting a Worker)
 * says nothing about the stored bytes and yields `null`. The code is tested
 * with `typeof`, never truthiness: code 0 is the truncated stream.
 */
export function classifyColdDecompressFailure(error: unknown): 'damaged' | null {
    if (!error || typeof error !== 'object') {
        return null
    }
    const code = (error as { code?: unknown }).code
    return typeof code === 'number' && fflateDataFormatCodes.has(code) ? 'damaged' : null
}

/**
 * `'damaged'` when `error` says the stored bytes themselves are bad: it passes
 * `classifyColdDecompressFailure`, or it is named `SyntaxError` (what
 * `JSON.parse` throws, recognised by name so another realm's error counts).
 * Every other failure while decoding says nothing about the data and yields
 * `null`, so the read stays a plain error that invites a retry.
 *
 * The name rule is for the `JSON.parse` step only: the same name on a failure
 * of the decompress step (a DOMException from starting a Worker) is not bad
 * data, so the reader judges that step with `classifyColdDecompressFailure`
 * (see `readLocalColdStorageValue` in `coldstorage.svelte.ts`).
 */
export function classifyColdDecodeFailure(error: unknown): 'damaged' | null {
    if (classifyColdDecompressFailure(error)) {
        return 'damaged'
    }
    if (!error || typeof error !== 'object') {
        return null
    }
    return (error as { name?: unknown }).name === 'SyntaxError' ? 'damaged' : null
}

/**
 * `preLoadChat`'s outcome (`coldstorage.svelte.ts`):
 *   - `'none'`        -- the chat wasn't found, or its first message isn't a
 *                        live cold-storage pointer (nothing to do). Also used
 *                        when the pointer was replaced by something else while
 *                        the read was in flight, or when the user switched to
 *                        a different character while it was in flight -- in
 *                        either case, restoring into this chat would be wrong.
 *   - `'ok'`          -- the read succeeded and the chat's messages/side
 *                        fields were restored.
 *   - `'missing'`     -- the reader positively confirmed the data doesn't
 *                        exist. Never mutates the chat, exactly like the
 *                        failure values below -- the pointer is left in place,
 *                        since a `.bin` restore from another device might
 *                        still hold the blob.
 *   - `'error'`       -- the read failed in a way that may work later (an I/O
 *                        failure, a permission error): the pointer is left in
 *                        place so the read can simply be retried by reopening
 *                        the chat.
 *   - `'unavailable'` -- this page offers no storage for archived data.
 *   - `'damaged'`     -- the pointer's key cannot be a storage name, the bytes
 *                        did not decode, or the decoded value is not a chat.
 * No value mutates `chat.message` and the returned promise never rejects.
 */
export type PreLoadChatResult = 'none' | 'ok' | 'missing' | 'error' | 'unavailable' | 'damaged'

/**
 * `retryLegacyColdChatLoad`'s outcome (`coldstorage.svelte.ts`), mirroring
 * `PreLoadChatResult` but for a chat whose `message[0]` already holds the
 * legacy "could not be loaded" error text (`matchColdStorageLoadErrorKey`),
 * rather than a live `coldStorageHeader` pointer:
 *   - `'none'`        -- the chat's first message isn't that exact error
 *                        text when the read finishes, the selected character changed
 *                        while the read was in flight, or the chat identity or
 *                        order at `chatIndex` changed underneath it (a plugin
 *                        replaced the character, or its chats were
 *                        reordered). Nothing to retry, or unsafe to apply the
 *                        result.
 *   - `'busy'`        -- `doingChat` or the chat's own `isStreaming` was set,
 *                        either before the read started or by the time it
 *                        finished. Retry again once sending settles.
 *   - `'ok'`          -- the read succeeded and the chat's messages/side
 *                        fields were restored.
 *   - `'missing'`     -- the reader positively confirmed the data doesn't
 *                        exist.
 *   - `'error'`       -- the read failed in a way that may work later, or the
 *                        side-field merge failed (it can fail from the live
 *                        chat as well as from the stored data, so it is not
 *                        called damaged).
 *   - `'unavailable'` -- this page offers no storage for archived data.
 *   - `'damaged'`     -- the error text's key cannot be a storage name, the
 *                        bytes did not decode, or the decoded value is not a
 *                        chat.
 * Every value except `'ok'` leaves the chat unmutated, so nothing is lost.
 */
export type RetryLegacyColdChatLoadResult = 'none' | 'busy' | 'ok' | 'missing' | 'error' | 'unavailable' | 'damaged'

/**
 * The notice shown in place of an archived chat that `preLoadChat` could not
 * restore, or `null` when there is nothing to show (`'none'`, `'ok'`). Every
 * result value has its own case; adding a value without one fails the type
 * check. Only `'error'` invites a retry and only `'missing'` says the data is
 * gone.
 */
export function coldChatNoticeText(result: PreLoadChatResult, coldDataKey: string): string | null {
    switch (result) {
        case 'none':
        case 'ok':
            return null
        case 'missing':
            return language.errors.coldStorageChatDataMissing(coldDataKey)
        case 'error':
            return language.errors.coldStorageChatLoadFailed(coldDataKey)
        case 'unavailable':
            return language.errors.coldStorageChatUnavailable(coldDataKey)
        case 'damaged':
            return language.errors.coldStorageChatDamaged(coldDataKey)
        default: {
            const unhandled: never = result
            return unhandled
        }
    }
}

/**
 * What the chat screen remembers about a legacy error-text chat after its
 * Retry button was pressed. `'pending'` disables the button; `'missing'`,
 * `'unavailable'` and `'damaged'` hold an outcome a repeated press cannot
 * change; `'retryFailed'` holds a failure that may work later.
 */
export type LegacyRetryState = 'pending' | 'missing' | 'retryFailed' | 'unavailable' | 'damaged'

/**
 * The state to record for a `retryLegacyColdChatLoad` result, or `null` to
 * delete the entry: after `'ok'` the notice disappears on its own because
 * `message[0]` stops matching the error text, and after `'none'` nothing
 * changed and there is nothing useful to show. Exhaustive over the result.
 */
export function legacyRetryStateFor(result: RetryLegacyColdChatLoadResult): LegacyRetryState | null {
    switch (result) {
        case 'ok':
        case 'none':
            return null
        case 'missing':
            return 'missing'
        case 'error':
        case 'busy':
            return 'retryFailed'
        case 'unavailable':
            return 'unavailable'
        case 'damaged':
            return 'damaged'
        default: {
            const unhandled: never = result
            return unhandled
        }
    }
}

/**
 * What the legacy error-text notice shows for `state`: the text, an optional
 * second line, and whether the Retry button is offered. Before any retry
 * (`undefined`, `'pending'`) the cause is unknown, so the notice keeps the
 * retry invitation. After a retry whose outcome a repeated press cannot change
 * (`'missing'`, `'unavailable'`, `'damaged'`) the button is hidden and the text
 * names the case; only `'retryFailed'` adds the try-later line. Exhaustive over
 * the state.
 */
export function legacyRetryView(state: LegacyRetryState | undefined): { text: string, detail: string | null, showRetry: boolean } {
    switch (state) {
        case 'missing':
            return { text: language.errors.coldStorageLegacyChatDataMissing, detail: null, showRetry: false }
        case 'unavailable':
            return { text: language.errors.coldStorageLegacyChatUnavailable, detail: null, showRetry: false }
        case 'damaged':
            return { text: language.errors.coldStorageLegacyChatDamaged, detail: null, showRetry: false }
        case 'retryFailed':
            return { text: language.errors.coldStorageLegacyChatRetryNotice, detail: language.errors.coldStorageLegacyChatRetryFailed, showRetry: true }
        case 'pending':
        case undefined:
            return { text: language.errors.coldStorageLegacyChatRetryNotice, detail: null, showRetry: true }
        default: {
            const unhandled: never = state
            return unhandled
        }
    }
}

/**
 * The four per-chat side fields a cold blob can carry, shared by
 * `retryLegacyColdChatLoad` (`coldstorage.svelte.ts`) for both the "live"
 * chat and the restored blob.
 */
export type RetryLegacyColdChatSideFields = Pick<Chat, 'hypaV2Data' | 'hypaV3Data' | 'scriptstate' | 'localLore'>

function normalizeChatMemos(memos: string[] | Set<string> | undefined | null): string[] {
    if (!memos) {
        return []
    }
    return Array.isArray(memos) ? memos : Array.from(memos)
}

function mergeHypaV3Categories(
    blobCategories: SerializableHypaV3Data['categories'] | undefined,
    liveCategories: SerializableHypaV3Data['categories'] | undefined,
): SerializableHypaV3Data['categories'] | undefined {
    if (!blobCategories?.length && !liveCategories?.length) {
        return liveCategories ?? blobCategories
    }
    const seenIds = new Set<string>()
    const merged: NonNullable<SerializableHypaV3Data['categories']> = []
    for (const category of [...(blobCategories ?? []), ...(liveCategories ?? [])]) {
        if (seenIds.has(category.id)) {
            continue
        }
        seenIds.add(category.id)
        merged.push(category)
    }
    return merged
}

/**
 * hypaV3 links a summary to the messages it covers by `chatId` memo, not by
 * index (`hypav3.ts`'s `startIdx` computation) -- keeping only the live
 * post-error memory would push every restored message before `startIdx`, so
 * it would never be summarized or prompted again. Emptiness is judged on
 * `summaries.length` alone (semantic, not deep-equal to the cold-storage
 * reset shape): a live chat that never re-accumulated any summary of its
 * own takes the blob's data wholesale, even if some OTHER field (e.g.
 * `modalSettings`) happens to be set on it (CHORE-07).
 *
 * **Accepted limit.** This only protects BLOB messages the blob's own
 * summaries already covered. After the merge, the last summary is a live
 * post-error one, so `startIdx` (`[...lastSummary.chatMemos].at(-1)`) is
 * computed from THAT summary's memos -- any blob
 * message the blob never got around to summarizing (or every blob message,
 * if the blob has `{summaries:[]}` while live has summaries) falls before
 * `startIdx` and is never summarized or prompted again. The same applies to
 * `mergeHypaV2SideField` below when the blob has no `mainChunks` but live
 * does. This is a memory-context gap only -- `chat.message` itself still
 * has every message, restored blob and live tail alike; nothing is lost,
 * only left out of future summarization/prompting until the next full
 * re-summarize.
 */
function mergeHypaV3SideField(
    live: SerializableHypaV3Data | undefined,
    blob: SerializableHypaV3Data | undefined,
    droppedErrorMessageChatId: string | undefined,
): SerializableHypaV3Data | undefined {
    const liveSummaries = live?.summaries ?? []
    if (liveSummaries.length === 0) {
        return blob ? { ...blob } : live
    }

    // The dropped error-text message may have picked up a `chatId` memo on
    // the user's first post-error send (`index.svelte.ts`). Any live
    // summary that still references it must have that one memo removed, or
    // `cleanOrphanedSummary` (`hypav3.ts`) would delete the whole
    // summary on the next send, since the message it was keyed to is gone
    // -- unless `preserveOrphanedMemory` is set (also in `hypav3.ts`). If
    // stripping that one memo leaves a summary with NO memos left at all,
    // this drops the summary outright here instead: `hypav3.ts`'s own
    // `startIdx` computation reads `[...lastSummary.chatMemos].at(-1)`,
    // which would be `undefined` for a summary with an empty list, so an
    // empty-chatMemos summary must never be allowed to become the last one.
    const strippedLiveSummaries = droppedErrorMessageChatId
        ? liveSummaries
            .map((summary) => {
                const memos = normalizeChatMemos(summary.chatMemos)
                if (!memos.includes(droppedErrorMessageChatId)) {
                    return summary
                }
                return {
                    ...summary,
                    chatMemos: memos.filter((memo) => memo !== droppedErrorMessageChatId),
                }
            })
            .filter((summary) => normalizeChatMemos(summary.chatMemos).length > 0)
        : liveSummaries

    return {
        ...live,
        summaries: [...(blob?.summaries ?? []), ...strippedLiveSummaries],
        categories: mergeHypaV3Categories(blob?.categories, live?.categories),
    }
}

/**
 * hypaV2's `mainChunks` are numbered ids, so concatenating blob and live
 * would collide -- this is always a full replacement, never a splice. If
 * the blob has any `mainChunks`, its data is taken wholesale: the
 * post-error messages then sit after `startIdx`, and the normal
 * summarization loop picks them up again. Otherwise the live value (which
 * may itself be empty, if the chat never accumulated hypaV2 memory either
 * before or after the error) is kept untouched (CHORE-07).
 */
function mergeHypaV2SideField(
    live: SerializableHypaV2Data | undefined,
    blob: SerializableHypaV2Data | undefined,
): SerializableHypaV2Data | undefined {
    if (blob?.mainChunks?.length) {
        return blob
    }
    return live
}

/**
 * The side-field merge `retryLegacyColdChatLoad` (`coldstorage.svelte.ts`)
 * applies when restoring a legacy error-text chat's OBJECT-shaped blob --
 * never for a legacy array blob, which carries no side fields at all and
 * whose caller leaves the live side fields untouched instead of calling
 * this (CHORE-07).
 *
 * `droppedErrorMessageChatId` is the `chatId` of the error-text
 * `message[0]` being dropped by the restore, if it has one yet (it only
 * gets one on the user's first post-error send) -- passed through to the
 * hypaV3 merge so it can strip that memo out of any live summary that
 * references it.
 */
export function mergeRetriedColdChatSideFields(
    live: RetryLegacyColdChatSideFields,
    blob: RetryLegacyColdChatSideFields,
    droppedErrorMessageChatId: string | undefined,
): RetryLegacyColdChatSideFields {
    return {
        hypaV2Data: mergeHypaV2SideField(live.hypaV2Data, blob.hypaV2Data),
        hypaV3Data: mergeHypaV3SideField(live.hypaV3Data, blob.hypaV3Data, droppedErrorMessageChatId),
        scriptstate: { ...(blob.scriptstate ?? {}), ...(live.scriptstate ?? {}) },
        localLore: [...(blob.localLore ?? []), ...(live.localLore ?? [])],
    }
}

/**
 * Collects the key from any chat whose FIRST message exactly matches the
 * cold-storage load-error text, regardless of how many messages follow it
 * -- a user who kept chatting after the error keeps every later message,
 * and this only inspects `message[0]`. These blobs are still referenced by
 * that visible error text and must not be treated as unused
 * (CHORE-07).
 */
export function listRecoverableErrorKeysFromDb(db: Pick<Database, 'characters'> | null | undefined): string[] {
    const keys = new Set<string>()
    for (const character of db?.characters ?? []) {
        if (!character) {
            continue
        }
        for (const chat of character.chats ?? []) {
            const key = matchColdStorageLoadErrorKey(chat.message?.[0]?.data)
            if (key) {
                keys.add(key)
            }
        }
    }
    return Array.from(keys)
}

export function getColdStorageBackupKey(name: string): string | null {
    const match = name.match(/^(?:coldstorage[/_])?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.json$/)
    return match?.[1] ?? null
}

/**
 * True when a restore would place a unit under `key`, i.e. the entry name the
 * backup writer produces for it is one `getColdStorageBackupKey` maps back to
 * the same key. A key that fails this and was found inside an archive or named
 * by load-error text is never read or written by a backup; the keys the
 * database itself points at are read as listed.
 */
export function isRestorableColdStorageKey(key: string): boolean {
    return getColdStorageBackupKey(getColdStorageBackupName(key)) === key
}

export function getColdStorageBackupName(key: string): string {
    return `coldstorage_${key}.json`
}

export function isColdStorageBackupData(data: unknown): boolean {
    if (Array.isArray(data)) {
        return true
    }

    return !!data
        && typeof data === 'object'
        && ('character' in data || 'message' in data)
}

/**
 * Whether a restore stores the parsed body of a backup entry as a unit.
 * Under the name the backup writer produces (`coldstorage_<uuid>.json`) any
 * JSON body is a unit: plugin storage holds values of every shape. Under any
 * other accepted name (bare `<uuid>.json`, `coldstorage/<uuid>.json`) the body
 * must still be chat or character shaped.
 */
export function isAcceptedColdStorageBackupEntry(name: string, data: unknown): boolean {
    if (name.startsWith('coldstorage_') && getColdStorageBackupKey(name) !== null) {
        return true
    }
    return isColdStorageBackupData(data)
}

export type ColdStorageInnerKey = {
    key: string
    kind: 'pointer' | 'errorText'
}

function classifyFirstMessage(message: unknown): ColdStorageInnerKey | null {
    if (!message || typeof message !== 'object') {
        return null
    }
    const data = (message as { data?: unknown }).data
    if (typeof data !== 'string') {
        return null
    }
    if (data.startsWith(coldStorageHeader)) {
        return { key: data.slice(coldStorageHeader.length), kind: 'pointer' }
    }
    const errorKey = matchColdStorageLoadErrorKey(data)
    return errorKey ? { key: errorKey, kind: 'errorText' } : null
}

function classifyChatFirstMessage(chat: unknown): ColdStorageInnerKey | null {
    if (!chat || typeof chat !== 'object') {
        return null
    }
    const message = (chat as { message?: unknown }).message
    return Array.isArray(message) ? classifyFirstMessage(message[0]) : null
}

/**
 * The cold-storage keys an archive value refers to: the pointer in, or the
 * legacy load-error text naming, the first message of every chat it holds.
 * Handles a character blob (`{character: {chats}}`), a chat unit
 * (`{message: [...]}`) and a legacy bare message array. Total: whatever else
 * the value holds, or however malformed an inner field is, that part
 * contributes no key and nothing throws. A key reached both ways is a pointer.
 */
export function listInnerColdStorageKeys(value: unknown): ColdStorageInnerKey[] {
    const found = new Map<string, ColdStorageInnerKey>()
    const add = (inner: ColdStorageInnerKey | null) => {
        if (inner && found.get(inner.key)?.kind !== 'pointer') {
            found.set(inner.key, inner)
        }
    }

    if (Array.isArray(value)) {
        add(classifyFirstMessage(value[0]))
    }
    else if (value && typeof value === 'object') {
        const archive = value as { character?: unknown, message?: unknown }
        if (Array.isArray(archive.message)) {
            add(classifyFirstMessage(archive.message[0]))
        }
        const character = archive.character
        if (character && typeof character === 'object') {
            const chats = (character as { chats?: unknown }).chats
            if (Array.isArray(chats)) {
                for (const chat of chats) {
                    add(classifyChatFirstMessage(chat))
                }
            }
        }
    }
    return Array.from(found.values())
}

function listColdDataKeysFromCharacter(character: character | groupChat): string[] {
    const keys: string[] = []
    if (character.coldstorage) {
        keys.push(character.coldstorage)
        if (Array.isArray(character.coldStoragedChats)) {
            keys.push(...character.coldStoragedChats)
        }
    }
    const chats: unknown = character.chats
    if (Array.isArray(chats)) {
        for (const chat of chats) {
            const inner = classifyChatFirstMessage(chat)
            if (inner?.kind === 'pointer') {
                keys.push(inner.key)
            }
        }
    }
    return keys
}

function listColdErrorKeysFromCharacter(character: character | groupChat): string[] {
    const keys: string[] = []
    const chats: unknown = character.chats
    if (Array.isArray(chats)) {
        for (const chat of chats) {
            const inner = classifyChatFirstMessage(chat)
            if (inner?.kind === 'errorText') {
                keys.push(inner.key)
            }
        }
    }
    return keys
}

/** The unit ids the plugin storage mapping (`_coldplugin`) points at. */
export function listColdPluginStorageKeys(db: Pick<Database, 'pluginCustomStorage'> | null | undefined): string[] {
    const mapping: unknown = db?.pluginCustomStorage?._coldplugin
    if (!mapping || typeof mapping !== 'object') {
        return []
    }
    return Object.values(mapping).filter((key): key is string => typeof key === 'string')
}

export function listColdDataKeysFromDb(db: Pick<Database, 'characters'|'pluginCustomStorage'> | null | undefined): string[] {
    const keys = new Set<string>()
    for (const character of db?.characters ?? []) {
        if (!character) {
            continue
        }
        for (const key of listColdDataKeysFromCharacter(character)) {
            keys.add(key)
        }
    }

    for (const key of listColdPluginStorageKeys(db)) {
        keys.add(key)
    }

    return Array.from(keys)
}

/**
 * Where a backup starts reading from. `normal` roots are the keys the
 * database points at (stub, `coldStoragedChats`, a live chat's pointer);
 * `errorText` roots are the keys a live chat's legacy load-error text names;
 * `plugin` roots are plugin storage units, whose content is carried but never
 * searched for further references. `owner` is the display name of the
 * character the root was found on.
 */
export type ColdBackupRoot = {
    key: string
    kind: 'normal' | 'errorText' | 'plugin'
    owner?: string
}

function getColdStorageCharacterLabel(character: character | groupChat): string {
    const name = typeof character.name === 'string' ? character.name.trim() : ''
    const chaId = typeof character.chaId === 'string' ? character.chaId : ''
    return name || chaId || language.errors.coldStorageUnknownCharacterName
}

export function listColdBackupRoots(db: Pick<Database, 'characters'|'pluginCustomStorage'> | null | undefined): ColdBackupRoot[] {
    const roots: ColdBackupRoot[] = []
    for (const character of db?.characters ?? []) {
        if (!character) {
            continue
        }
        const owner = getColdStorageCharacterLabel(character)
        for (const key of listColdDataKeysFromCharacter(character)) {
            roots.push({ key, kind: 'normal', owner })
        }
        for (const key of listColdErrorKeysFromCharacter(character)) {
            roots.push({ key, kind: 'errorText', owner })
        }
    }
    for (const key of listColdPluginStorageKeys(db)) {
        roots.push({ key, kind: 'plugin' })
    }
    return roots
}

export function getColdStorageAffectedCharacters(
    db: Pick<Database, 'characters'> | null | undefined,
    unavailableKeys: Iterable<string>,
    ownersByKey?: ReadonlyMap<string, readonly string[]>,
): {
    characterNames: string[]
    unresolvedKeys: string[]
} {
    const targetKeys = new Set(unavailableKeys)
    const resolvedKeys = new Set<string>()
    const characterNames: string[] = []

    for (const character of db?.characters ?? []) {
        if (!character) {
            continue
        }

        let isAffected = false
        for (const key of listColdDataKeysFromCharacter(character)) {
            if (targetKeys.has(key)) {
                resolvedKeys.add(key)
                isAffected = true
            }
        }

        if (isAffected) {
            characterNames.push(getColdStorageCharacterLabel(character))
        }
    }

    // A key found only inside an archive, or named only by a live chat's
    // load-error text, is not in any character's own list; the collector
    // recorded which characters' roots and archives led to it.
    if (ownersByKey) {
        for (const key of targetKeys) {
            const owners = resolvedKeys.has(key) ? undefined : ownersByKey.get(key)
            if (!owners?.length) {
                continue
            }
            resolvedKeys.add(key)
            for (const owner of owners) {
                if (!characterNames.includes(owner)) {
                    characterNames.push(owner)
                }
            }
        }
    }

    return {
        characterNames,
        unresolvedKeys: Array.from(targetKeys).filter((key) => !resolvedKeys.has(key)),
    }
}
