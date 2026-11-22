/**
 * Empirical reproduction for CHORE-07: "A transient cold-storage READ
 * failure permanently orphans a chat."
 *
 * ALLEGED MECHANISM (source-traced by an investigator, re-verified against
 * source before this harness was written):
 *
 *   1. src/ts/process/coldstorage.svelte.ts `getColdStorageItem` (the OPFS
 *      branch actually exercised here is lines 86-104 of the file as it
 *      stands today -- the investigator's ~74-104 was for the whole
 *      function including the isTauri branch; the isNodeServer/isTauri/OPFS
 *      branches each independently wrap their read in try/catch and return
 *      null on ANY error) swallows every error and returns null, making a
 *      thrown read indistinguishable from "not found".
 *
 *   2. `preLoadChat` (lines 627-665; the corrupting else-branch is
 *      650-661, not 650-661 approximately -- confirmed exact) treats a
 *      null/falsy return as "missing or corrupted" and OVERWRITES
 *      chat.message with a single error-message entry
 *      `[Cold storage data could not be loaded. Key: <key>]`, destroying
 *      the cold pointer (chat.message[0].data =
 *      coldStorageHeader + key) permanently -- there is no retry and no
 *      distinction between "transient" and "actually gone".
 *
 *   3. That mutation lands on DBState.db.characters[i].chats[j], and if
 *      character i is the SELECTED character, dbChangeEffects.svelte.ts's
 *      generic per-key effect (:93-122) deep-reads exactly
 *      `DBState.db.characters[selIdState].chats` and marks
 *      opts.tracker.character / opts.tracker.chat dirty, which is what
 *      gates RisuSaveEncoder.set() re-encoding that character's block from
 *      the live (now-corrupted) object.
 *
 *   4. A later cleanColdStorage() (:244-262) computes "used" keys by
 *      scanning the saved DB for coldStorageHeader-prefixed pointers
 *      (listColdDataKeys -> listColdDataKeysFromDb in coldstorageData.ts).
 *      Since the pointer is gone, the still-physically-present blob no
 *      longer shows up as "used" and gets deleted as orphaned -- turning a
 *      one-time transient read error into permanent data loss.
 *
 * UPDATE (post stage-7a fix, `Agents/Reports/13-chore07-cold-read-failure-plan.md`
 * §2.2): point 4 above described the code as it stood BEFORE this plan's
 * fix landed. `cleanColdStorage` now also unions in
 * `listRecoverableErrorKeysFromDb(db)`, which matches any chat whose
 * `message[0].data` exactly equals the `[Cold storage data could not be
 * loaded. Key: ...]` template `preLoadChat` writes, and keeps that key. So
 * step (e) below no longer observes MAIN_KEY being deleted -- it is now
 * kept, because the corrupted chat's error text itself is a recognized
 * pointer. The paragraph above (and points 1-3) are left as originally
 * written because they are still the accurate mechanism for HOW the
 * pointer gets destroyed; only the final consequence in point 4 changed.
 * MISSING_KEY (the genuinely-never-written control) is unaffected: it was
 * never physically present in the backend, so there was never anything for
 * cleanColdStorage to delete or keep for that key either before or after
 * this fix.
 *
 * This harness drives the REAL getColdStorageItem, preLoadChat,
 * listColdDataKeys and cleanColdStorage from coldstorage.svelte.ts, the
 * REAL registerDbChangeEffects() from dbChangeEffects.svelte.ts, and the
 * REAL RisuSaveEncoder / decodeRisuSave from risuSave.ts -- not
 * reimplementations. Only the storage BACKEND is mocked: this harness runs
 * under happy-dom with isTauri=false / isNodeServer=false / account=false,
 * so getColdStorageItem/setColdStorageItem/listColdStorageItems/
 * removeColdStorageItems all take the OPFS branch
 * (`navigator.storage.getDirectory()`), which happy-dom does not implement.
 * `navigator.storage` is replaced with an in-memory directory-handle mock
 * backed by a plain Map, with one extra knob: a set of filenames armed to
 * throw exactly once on `getFileHandle` (modelling a transient IndexedDB /
 * OPFS / network read failure) while the entry stays in the Map the whole
 * time -- i.e. the blob is never actually gone until cleanColdStorage
 * removes it.
 *
 * TWO IMPORT-GRAPH TRAPS FOUND WHILE BUILDING THIS (both avoided by mocking
 * the modules below, not by editing src/):
 *   - `../alert` (alertClear/alertConfirm/alertError/alertWait, used by
 *     cleanColdStorage) transitively imports `./util`, which imports
 *     `./characters`, which imports `./parser/parser.svelte` -- the exact
 *     "real module fires a top-level $effect.root against a thin
 *     stores.svelte mock" trap the README warns about for
 *     trash-restore-repro. Mocked directly instead of tracing further.
 *   - `../sionyw` (fetchProtectedResource, only reachable here if
 *     forageStorage.isAccount were true, which it never is in this
 *     harness) transitively imports `./characterCards`, which ALSO imports
 *     `./parser/parser.svelte`. Mocked directly for the same reason.
 * `src/lang` and `./coldstorageData` were checked and are safe to import
 * for real (no imports beyond data / `../polyfill`, no runes).
 *
 * Per Agents/Tools/README.md's "Harnesses that mock the app's rune
 * modules: keep them in ONE file" -- every vi.mock factory and every
 * rune-touching helper lives in this one `.svelte.harness.ts` file.
 *
 * Run:
 *   npx vitest run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/cold-storage-orphan-repro.svelte.harness.ts --reporter=verbose
 *
 * Read-only w.r.t. src/ -- this file drives the real modules, it does not
 * modify them.
 */
import { flushSync } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi } from 'vitest'
import type { Database } from '../../../src/ts/storage/database.svelte'
import type { toSaveType } from '../../../src/ts/storage/risuSave'

//#region module mocks

const risuSaveCacheStore = new Map<string, unknown>()

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => risuSaveCacheStore.get(key) ?? null),
            setItem: vi.fn(async (key: string, value: unknown) => {
                risuSaveCacheStore.set(key, value)
            }),
            removeItem: vi.fn(async (key: string) => {
                risuSaveCacheStore.delete(key)
            }),
        }),
    },
}))

vi.mock(
    import('src/ts/globalApi.svelte'),
    () =>
        ({
            forageStorage: {
                isAccount: false,
                keys: vi.fn(async () => []),
                getItem: vi.fn(async () => null),
                setItem: vi.fn(async () => {}),
                realStorage: undefined,
            },
            requiresFullEncoderReload: { state: false },
            fetchNative: vi.fn(),
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

vi.mock(
    import('src/ts/storage/database.svelte'),
    () =>
        ({
            getDatabase: vi.fn(() => {
                throw new Error('no live database in tests')
            }),
            presetTemplate: { name: 'test-preset' },
        }) as unknown as typeof import('src/ts/storage/database.svelte'),
)

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    remove: vi.fn(),
    readDir: vi.fn(async () => []),
    BaseDirectory: { AppData: 0 },
}))

// See file-header trap notes: `../alert` and `../sionyw` both transitively
// reach `./parser/parser.svelte` via `./util` / `./characterCards`. Neither
// is on the code path this harness exercises in a way that needs real
// behaviour -- cleanColdStorage's alertWait/alertClear are UI progress
// toasts, and fetchProtectedResource is only reachable when
// forageStorage.isAccount is true, which it never is here.
vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertWait: vi.fn(),
}))

vi.mock(import('src/ts/sionyw'), () => ({
    fetchProtectedResource: vi.fn(async () => ({ status: 404 }) as unknown as Response),
}))

// dbChangeEffects.svelte.ts / coldstorage.svelte.ts both reach into
// DBState/selectedCharID from stores.svelte, which transitively re-exports
// the app's whole dependency graph. Replace it with a minimal, genuinely
// reactive ($state-backed) stand-in, identical in spirit to
// dbChangeEffects.svelte.test.ts's own mock and to
// trash-restore-repro.svelte.harness.ts's. The factory constructs the
// `$state` object directly (no cross-file dynamic import) -- splitting that
// across files reproduces the unhandled-exception trap documented in the
// README.
vi.mock(import('../../../src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('../../../src/ts/stores.svelte')
})

//#endregion

import { DBState, selectedCharID } from '../../../src/ts/stores.svelte'
import { registerDbChangeEffects } from '../../../src/ts/storage/dbChangeEffects.svelte'
import { decodeRisuSave } from '../../../src/ts/storage/risuSave'
import { RisuSaveEncoder } from '../../../src/ts/storage/tests/risuSaveEncoder'
import {
    coldStorageHeader,
    getColdStorageItem,
    setColdStorageItem,
    preLoadChat,
    listColdDataKeys,
    listColdStorageItems,
    cleanColdStorage,
} from '../../../src/ts/process/coldstorage.svelte'

//#region OPFS backend mock (the "storage backend" being mocked, per the task)

/**
 * In-memory stand-in for `navigator.storage.getDirectory()`'s
 * FileSystemDirectoryHandle, backed by a plain Map. `throwOnceFilenames`
 * models a transient read failure: `getFileHandle` throws exactly once for
 * an armed filename (removing itself from the set), while the Map entry is
 * left completely untouched -- the blob is never actually gone, only
 * unreadable for that one call.
 */
const opfsStore = new Map<string, Uint8Array>()
const throwOnceFilenames = new Set<string>()

function opfsFilename(key: string): string {
    return 'coldstorage_' + key + '.json'
}

function armTransientFailure(key: string): void {
    throwOnceFilenames.add(opfsFilename(key))
}

class MockNotFoundError extends Error {
    name = 'NotFoundError'
}

const mockDirectoryHandle = {
    async getFileHandle(name: string, opts?: { create?: boolean }) {
        if (throwOnceFilenames.has(name)) {
            throwOnceFilenames.delete(name)
            throw new Error(`simulated transient OPFS read failure for ${name}`)
        }
        if (opts?.create) {
            return {
                async createWritable() {
                    return {
                        async write(data: Uint8Array) {
                            opfsStore.set(name, data)
                        },
                        async close() {},
                    }
                },
            }
        }
        if (!opfsStore.has(name)) {
            throw new MockNotFoundError(`not found: ${name}`)
        }
        return {
            async getFile() {
                const bytes = opfsStore.get(name)!
                return {
                    async arrayBuffer() {
                        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
                    },
                }
            },
        }
    },
    async removeEntry(name: string) {
        if (!opfsStore.has(name)) {
            throw new MockNotFoundError(`not found: ${name}`)
        }
        opfsStore.delete(name)
    },
    entries() {
        const iter = opfsStore.keys()
        return {
            [Symbol.asyncIterator]() {
                return {
                    async next() {
                        const r = iter.next()
                        if (r.done) {
                            return { done: true as const, value: undefined }
                        }
                        return { done: false as const, value: [r.value, {}] as [string, unknown] }
                    },
                }
            },
        }
    },
}

Object.defineProperty(globalThis.navigator, 'storage', {
    configurable: true,
    value: {
        getDirectory: async () => mockDirectoryHandle,
    },
})

//#endregion

//#region fixture helpers

type CharacterFixture = Database['characters'][number]

function makeColdChat(id: string, coldKey: string) {
    return {
        id,
        message: [{ time: 1_690_000_000_000, data: coldStorageHeader + coldKey, role: 'char' }],
        note: '',
        name: '',
        localLore: [],
    }
}

function makeCharacter(chaId: string, name: string, chats: unknown[]): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        chatPage: 0,
        chats,
    } as unknown as CharacterFixture
}

const MAIN_KEY = 'main-chat-cold-key'
const MISSING_KEY = 'missing-blob-key' // control: never written at all
const PROBE_KEY = 'probe-transient-key' // isolated demo for step (a), unrelated to any character

function installDb(): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: ['char-A', 'char-CONTROL'],
        characters: [
            makeCharacter('char-A', 'Character A', [makeColdChat('char-A-chat-0', MAIN_KEY)]),
            makeCharacter('char-CONTROL', 'Character Control (missing blob)', [
                makeColdChat('char-CONTROL-chat-0', MISSING_KEY),
            ]),
        ],
    } as unknown as Database
}

function makeTracker(): toSaveType {
    return {
        character: [],
        chat: [],
        botPreset: false,
        modules: false,
        loadouts: false,
        plugins: false,
        pluginCustomStorage: false,
    }
}

function flush(): void {
    flushSync()
}

function snapshotDb(db: Database): Database {
    return $state.snapshot(db) as Database
}

//#endregion

describe('CHORE-07: transient cold-storage read failure orphan reproduction', () => {
    test('a transient read failure destroys the cold pointer, persists, and the blob is later deleted as unused', async () => {
        const lines: string[] = []
        const log = (line: string) => lines.push(line)

        const coldPayload = {
            message: [
                { time: 1000, data: 'archived message 1', role: 'user' },
                { time: 2000, data: 'archived message 2', role: 'char' },
            ],
            hypaV2Data: { chunks: [], mainChunks: [], lastMainChunkID: 0 },
            hypaV3Data: { summaries: [] },
            scriptstate: {},
            localLore: [],
        }
        const probePayload = { message: [{ time: 500, data: 'probe payload', role: 'char' }] }

        // --- Fixture setup: write both real blobs to the mocked backend
        // via the REAL setColdStorageItem, before any failure is armed. ---
        const mainWriteOk = await setColdStorageItem(MAIN_KEY, coldPayload)
        const probeWriteOk = await setColdStorageItem(PROBE_KEY, probePayload)
        log(`setup: setColdStorageItem(MAIN_KEY) ok=${mainWriteOk}, setColdStorageItem(PROBE_KEY) ok=${probeWriteOk}`)
        expect(mainWriteOk).toBe(true)
        expect(probeWriteOk).toBe(true)

        // ================================================================
        // STEP (a): blob present, read throws once -> getColdStorageItem
        // returns null, not a throw.
        // ================================================================
        armTransientFailure(PROBE_KEY)
        let probeThrew = false
        let probeResultDuringFailure: unknown
        try {
            probeResultDuringFailure = await getColdStorageItem(PROBE_KEY)
        } catch (e) {
            probeThrew = true
        }
        log(`step(a): getColdStorageItem(PROBE_KEY) during armed transient failure -> threw=${probeThrew}, result=${JSON.stringify(probeResultDuringFailure)}`)
        // observed on unfixed code: the read swallows the thrown error and
        // returns null instead of propagating it
        expect(probeThrew).toBe(false)
        expect(probeResultDuringFailure).toBeNull()

        const probeResultAfterFailureConsumed = await getColdStorageItem(PROBE_KEY)
        log(`step(a): getColdStorageItem(PROBE_KEY) immediately after (failure already consumed) -> ${JSON.stringify(probeResultAfterFailureConsumed)}`)
        // observed on unfixed code: the blob was never actually gone -- the
        // very next read (no failure armed) returns the real payload
        expect(probeResultAfterFailureConsumed).toEqual(probePayload)

        // Cleanup: remove the probe blob from the backend directly so it
        // does not participate in step (e)'s cleanColdStorage accounting --
        // it was never referenced by any character to begin with, so
        // leaving it would just be unrelated "already orphaned" noise.
        opfsStore.delete(opfsFilename(PROBE_KEY))

        // ================================================================
        // Wire the REAL dbChangeEffects + RisuSaveEncoder end to end.
        // ================================================================
        installDb()
        const tracker = makeTracker()
        const markChanged = vi.fn()
        selectedCharID.set(0) // select char-A
        const cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flush()
        log(`setup: after selecting char-A and flushing, tracker.character=${JSON.stringify(tracker.character)}`)
        expect(tracker.character[0]).toBe('char-A') // sanity: effect 6 is wired to the real, live DBState/selectedCharID

        const encoder = new RisuSaveEncoder()
        await encoder.init(snapshotDb(DBState.db), { compression: false })
        const firstEncoded = encoder.encode()
        expect(firstEncoded).not.toBeNull()
        const firstDecoded = await decodeRisuSave(new Uint8Array(firstEncoded!))
        const firstDecodedA = firstDecoded.characters?.find((c: CharacterFixture) => c.chaId === 'char-A')
        const firstDecodedAData = firstDecodedA?.chats?.[0]?.message?.[0]?.data
        log(`setup: initial encode -> decoded char-A chat0 message0.data=${JSON.stringify(firstDecodedAData)}`)
        expect(firstDecodedAData).toBe(coldStorageHeader + MAIN_KEY) // pointer intact pre-corruption

        // ================================================================
        // STEP (b): preLoadChat, on a transient failure, replaces
        // chat.message with the error message and the cold pointer header
        // is gone.
        // ================================================================
        armTransientFailure(MAIN_KEY)
        const markChangedCallsBeforeCorruption = markChanged.mock.calls.length
        await preLoadChat(0, 0)
        const chatAfterCorruption = DBState.db.characters[0].chats[0]
        const corruptedData = chatAfterCorruption.message?.[0]?.data
        log(`step(b): after preLoadChat with armed transient failure, chat.message[0].data=${JSON.stringify(corruptedData)}`)
        // observed on unfixed code: the live chat message is overwritten
        // with the "could not be loaded" placeholder
        expect(corruptedData).toBe(`[Cold storage data could not be loaded. Key: ${MAIN_KEY}]`)
        // observed on unfixed code: the cold-storage pointer header is gone
        expect(corruptedData.startsWith(coldStorageHeader)).toBe(false)

        flush()
        const markChangedCallsAfterCorruption = markChanged.mock.calls.length
        log(`step(b)/(c): markChanged call count before=${markChangedCallsBeforeCorruption}, after corruption+flush=${markChangedCallsAfterCorruption}`)
        // observed on unfixed code: dbChangeEffects' generic per-key effect
        // deep-reads the selected character's chats and re-fires on this
        // exact mutation, marking the save dirty
        expect(markChangedCallsAfterCorruption).toBeGreaterThan(markChangedCallsBeforeCorruption)
        log(`step(c): tracker.character=${JSON.stringify(tracker.character)}, tracker.chat=${JSON.stringify(tracker.chat)}`)
        expect(tracker.character).toContain('char-A')

        // ================================================================
        // STEP (c) continued: encode/decode round trip after the
        // corruption -- the decoded chat holds the error message, not the
        // pointer.
        // ================================================================
        const toSave = structuredClone(tracker) as toSaveType
        await encoder.set(snapshotDb(DBState.db), toSave)
        const secondEncoded = encoder.encode()
        expect(secondEncoded).not.toBeNull()
        const secondDecoded = await decodeRisuSave(new Uint8Array(secondEncoded!))
        const secondDecodedA = secondDecoded.characters?.find((c: CharacterFixture) => c.chaId === 'char-A')
        const secondDecodedAData = secondDecodedA?.chats?.[0]?.message?.[0]?.data
        log(`step(c): post-corruption encode+decode -> decoded char-A chat0 message0.data=${JSON.stringify(secondDecodedAData)}`)
        // observed on unfixed code: the persisted save holds the error
        // message, not the cold-storage pointer -- the corruption survived
        // a full encode/decode round trip
        expect(secondDecodedAData).toBe(`[Cold storage data could not be loaded. Key: ${MAIN_KEY}]`)

        // ================================================================
        // STEP (d): a second read, now succeeding, cannot recover it via
        // the normal path -- while the blob is still present in the mocked
        // store.
        // ================================================================
        const directReadNowSucceeding = await getColdStorageItem(MAIN_KEY)
        log(`step(d): direct getColdStorageItem(MAIN_KEY) with no failure armed -> ${JSON.stringify(directReadNowSucceeding)}`)
        // observed on unfixed code: the blob itself was never lost -- a
        // normal (non-failing) read still returns the real payload
        expect(directReadNowSucceeding).toEqual(coldPayload)

        await preLoadChat(0, 0) // normal path, no failure armed this time
        const chatAfterSecondPreLoad = DBState.db.characters[0].chats[0].message?.[0]?.data
        log(`step(d): after a SECOND preLoadChat call (blob now readable), chat.message[0].data=${JSON.stringify(chatAfterSecondPreLoad)}`)
        // observed on unfixed code: preLoadChat's cold-storage branch is
        // gated on chat.message[0].data starting with coldStorageHeader,
        // which is no longer true (it is now the error string) -- so this
        // call is a silent no-op and does NOT recover the blob even though
        // it is fully readable
        expect(chatAfterSecondPreLoad).toBe(`[Cold storage data could not be loaded. Key: ${MAIN_KEY}]`)

        // ================================================================
        // CONTROL: a genuinely missing blob (never written, no failure
        // armed -- MISSING_KEY simply never existed) run through the same
        // flow, to distinguish "transient failure" from "truly missing".
        // ================================================================
        await preLoadChat(1, 0)
        const controlChatData = DBState.db.characters[1].chats[0].message?.[0]?.data
        log(`control: preLoadChat on a chat pointing at a NEVER-WRITTEN key -> chat.message[0].data=${JSON.stringify(controlChatData)}`)
        // observed on unfixed code: a genuinely-missing blob produces the
        // IDENTICAL user-visible error message as a transient failure --
        // the two are indistinguishable from the chat's perspective
        expect(controlChatData).toBe(`[Cold storage data could not be loaded. Key: ${MISSING_KEY}]`)

        // ================================================================
        // STEP (e): cleanColdStorage's direct DB scan (listColdDataKeys,
        // unchanged by the stage-7a fix) still finds neither key referenced
        // -- both pointers were overwritten with error messages, and that
        // raw scan has never looked at error text. Whether cleanColdStorage
        // itself then keeps or deletes the still-present MAIN_KEY blob is a
        // separate question, answered below after the fix.
        // ================================================================
        const usedKeysBeforeClean = await listColdDataKeys(DBState.db)
        const allKeysBeforeClean = (await listColdStorageItems()).items
        log(`step(e): before cleanColdStorage -> listColdDataKeys(DBState.db)=${JSON.stringify(usedKeysBeforeClean)}, listColdStorageItems().items=${JSON.stringify(allKeysBeforeClean)}`)
        // unchanged before and after the fix: listColdDataKeys is the raw
        // pointer scan, not cleanColdStorage's full accounting -- neither
        // key is referenced by it
        expect(usedKeysBeforeClean).not.toContain(MAIN_KEY)
        expect(usedKeysBeforeClean).not.toContain(MISSING_KEY)
        // observed on unfixed code: the MAIN_KEY blob is still physically
        // present in the backend (it was only orphaned, never deleted)
        expect(allKeysBeforeClean).toContain(MAIN_KEY)
        expect(allKeysBeforeClean).not.toContain(MISSING_KEY) // never existed

        await cleanColdStorage()

        const allKeysAfterClean = (await listColdStorageItems()).items
        const mainReadAfterClean = await getColdStorageItem(MAIN_KEY)
        log(`step(e): after cleanColdStorage -> listColdStorageItems().items=${JSON.stringify(allKeysAfterClean)}, getColdStorageItem(MAIN_KEY)=${JSON.stringify(mainReadAfterClean)}`)
        // PRE-FIX HISTORY: cleanColdStorage used to delete the orphaned
        // MAIN_KEY blob because it was (wrongly) unreferenced -- that was
        // the permanent data loss step this harness was written to prove.
        // Confirmed RED against the unfixed source: `expected [
        // 'main-chat-cold-key' ] to not include 'main-chat-cold-key'` at the
        // `not.toContain(MAIN_KEY)` assertion below (it used to read
        // `.not.toContain`; the deletion made the key ABSENT from
        // allKeysAfterClean, so the negated assertion failed).
        //
        // POST-FIX (stage 7a, §2.2): cleanColdStorage now also keeps any key
        // referenced only by an error-text message[0]
        // (listRecoverableErrorKeysFromDb), so the still-physically-present,
        // now-recoverable MAIN_KEY blob survives this cleanup instead.
        expect(allKeysAfterClean).toContain(MAIN_KEY)
        expect(mainReadAfterClean).not.toBeNull()
        expect(mainReadAfterClean).toEqual(coldPayload)
        // control comparison: MISSING_KEY was never physically present in
        // the backend (never written), so cleanColdStorage has nothing to
        // keep or delete for it either before or after this fix -- unlike
        // MAIN_KEY, whose blob really is still sitting in storage.
        expect(allKeysAfterClean).not.toContain(MISSING_KEY)

        cleanup()

        console.log(
            [
                '',
                '=== cold-storage-orphan-repro: full report ===',
                ...lines,
                '================================================',
                '',
            ].join('\n'),
        )
    })
})
