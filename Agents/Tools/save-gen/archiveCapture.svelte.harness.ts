// @vitest-environment happy-dom

/**
 * Capture harness: runs the real one-character archive writer on fixed inputs and compares or writes what it produced.
 * Each case is a character (or a card) that goes through `archiveCharacterNow`; the output is its source JSON, the stub
 * JSON the writer left in the list, and the exact gzip bytes of every unit the writer put in the page store.
 *
 * Real: `archiveCharacterNow`, `writeColdStorageUnit` with fflate `compress`, `readColdStorageItem`, `buildColdStub`,
 * `pointerChatKeys`, `coldUnitCharacter`, `coldUnitStoreKey`, and for the card cases the real importer with the real
 * `characterFormatUpdate`, `applyCharacterDefaults` and `resetChatStreamingState`. Replaced (see STAND_INS): the page byte
 * store, platform flags, uuid, the clock, alerts and the importer's surrounding application modules.
 *
 * Modes (run under `Agents/Tools/vitest.archiveCapture.config.ts`, which sets `ARCHIVE_CAPTURE_CONFIG`):
 * - default: verify against `ARCHIVE_CAPTURE_VERIFY_AGAINST` (default: the committed fixture directory); writes nothing.
 * - `ARCHIVE_CAPTURE_WRITE=1`: write the fixture files to `ARCHIVE_CAPTURE_OUT` (default: the committed fixture directory).
 *
 * Verify rules: V1 the file set is identical and every `.source.json` and `.stub.json` is deep-equal after parsing; V2 every
 * `.gz` has the same length and the same bytes with the gzip MTIME field (bytes 4 to 7) zeroed, and the same decompressed
 * payload; V3 `manifest.content` is deep-equal (`manifest.capture` is not compared); V4 the production tree is clean, has
 * not changed since `capture.baseCommit`, and that commit is an ancestor of HEAD.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, test, vi, beforeAll, afterAll } from 'vitest'
import { writable } from 'svelte/store'
import { decompressSync } from 'fflate'
import type { Database, character, groupChat } from 'src/ts/storage/database.svelte'

//#region module mocks

const h = vi.hoisted(() => ({
    /** The page byte store's content, by store key. */
    units: new Map<string, Uint8Array>(),
    uuid: 0,
}))

vi.mock('uuid', () => ({
    v4: () => `00000000-0000-4000-8000-${String(++h.uuid).padStart(12, '0')}`,
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0 },
    readDir: vi.fn(async () => []),
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    remove: vi.fn(async () => {}),
    readFile: vi.fn(async () => new Uint8Array()),
}))

vi.mock('@tauri-apps/plugin-deep-link', () => ({
    onOpenUrl: vi.fn(async () => vi.fn()),
}))

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((p: string) => p),
    invoke: vi.fn(async () => undefined),
}))

vi.mock(import('src/ts/upstreamAgreement'), () => ({
    askUpstreamAgreement: vi.fn(async () => true),
    isUpstreamAccepted: vi.fn(() => true),
    publishUpstreamAccepted: vi.fn(),
}) as unknown as typeof import('src/ts/upstreamAgreement'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        CharEmotion: writable({}),
        MobileGUIStack: writable([]),
        OpenRealmStore: writable(null),
        SettingsMenuIndex: writable(0),
        ShowRealmFrameStore: writable(false),
        settingsOpen: writable(false),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const { AppendableBuffer } = await import('src/ts/byteBuffer')
    return {
        AppendableBuffer,
        afterNextSaveCommit: () => {},
        getPeerSaveCount: () => 0,
        getSaveMarkCount: () => 0,
        isSaveClean: () => false,
        BlankWriter: class {},
        LocalWriter: class {},
        VirtualWriter: class {},
        changeChatTo: vi.fn(),
        checkCharOrder: vi.fn(),
        downloadFile: vi.fn(async () => {}),
        getFileSrc: vi.fn(),
        requiresFullEncoderReload: { state: false },
        forageStorage: {
            keys: vi.fn(async () => []),
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
        },
        loadAsset: vi.fn(async () => new Uint8Array()),
        openURL: vi.fn(),
        readImage: vi.fn(async (d: unknown) => d),
        saveAsset: vi.fn(async () => 'asset'),
        saveAssetFromPieces: vi.fn(async () => 'piece.png'),
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertAddCharacter: vi.fn(),
    alertCardExport: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertClear: vi.fn(),
    alertError: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertNormalWait: vi.fn(async () => {}),
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    alertWait: vi.fn(),
    waitAlert: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState: liveDBState } = await import('src/ts/stores.svelte')
    return {
        getDatabase: vi.fn(() => liveDBState.db),
        setDatabase: vi.fn((db: Database) => { liveDBState.db = db }),
        setDatabaseLite: vi.fn(),
        importPreset: vi.fn(),
        presetTemplate: { name: 'test-preset' },
        saveImage: vi.fn(),
        appVer: 'test',
        appSubVer: 'test',
        defaultSdDataFunc: vi.fn(() => ({})),
        getCharacterByIndex: vi.fn((index: number) => liveDBState.db.characters?.[index]),
        setCharacterByIndex: vi.fn((index: number, char: unknown) => {
            liveDBState.db.characters[index] = char as never
        }),
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    decryptBuffer: vi.fn(async (d: unknown) => d),
    findCharacterbyId: vi.fn(),
    findCharacterIndexbyId: vi.fn(() => -1),
    getUserName: vi.fn(() => 'User'),
    isKnownUri: vi.fn(() => false),
    selectFileByDom: vi.fn(async () => null),
    selectMultipleFile: vi.fn(),
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => {}),
    sleepForever: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: unknown) => d),
    getImageType: vi.fn(() => 'png'),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/process/inlayScreen'), () => ({
    updateInlayScreen: vi.fn((cha: unknown) => cha),
}) as unknown as typeof import('src/ts/process/inlayScreen'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    parseMarkdownSafe: vi.fn(),
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/translator/translator'), () => ({
    translateHTML: vi.fn(),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock(import('src/ts/pngChunk'), () => ({
    PngChunk: class {},
}) as unknown as typeof import('src/ts/pngChunk'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    reencodeImage: vi.fn(async (d: unknown) => d),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    decodeRPack: vi.fn(async (d: Uint8Array) => new Uint8Array(d)),
    encodeRPack: vi.fn(async (d: Uint8Array) => new Uint8Array(d)),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    convertExternalLorebook: vi.fn(),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

vi.mock(import('src/ts/interchangeability'), () => ({
    convertCharacterToModule: vi.fn(),
    convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))

vi.mock(import('src/ts/process/chatOrigin'), () => ({
    isWriting: () => false,
}) as unknown as typeof import('src/ts/process/chatOrigin'))

vi.mock(import('src/ts/media/avatarThumb'), () => ({
    getAvatarThumbSrc: vi.fn(),
    isThumbEligible: vi.fn(() => false),
}) as unknown as typeof import('src/ts/media/avatarThumb'))

vi.mock(import('src/ts/storage/autoStorage'), () => ({
    AutoStorage: class {
        realStorage: unknown = undefined
        async getItem() { return null }
        async setItem() { }
        async keys() { return [] }
        async removeItem() { }
    },
}) as unknown as typeof import('src/ts/storage/autoStorage'))

vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { createForageBackedStore } = await import('src/ts/storage/tests/forageBackedStore')
    const store = createForageBackedStore({
        getItem: async (key) => h.units.get(key) ?? null,
        setItem: async (key, value) => { h.units.set(key, value) },
        keys: async () => Array.from(h.units.keys()),
        removeItem: async (key) => { h.units.delete(key) },
    })
    return { getAppStore: async () => store } as unknown as typeof import('src/ts/storage/store/appStore')
})

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import { importCharacterFile, importCharacterProcess } from 'src/ts/characterCards'
import { archiveCharacterNow, type ArchiveTarget } from 'src/ts/process/coldCharacterArchive'
import { readColdStorageItem, setColdStorageItem } from 'src/ts/process/coldstorage.svelte'
import { coldUnitStoreKey } from 'src/ts/process/coldUnitLocation'
import { coldStorageHeader } from 'src/ts/process/coldstorageData'
import { noteBootArchiveSession, resetBootArchiveStateForTest } from 'src/ts/process/memory/bootArchiveState'
import { resetRetainedForTest } from 'src/ts/process/coldRetained'
import { resetRestoredBytesForTest } from 'src/ts/process/memory/restoredBytes'
import { resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { resetPutBackForTest } from 'src/ts/process/memory/characterPutBack'
import { ASSET_FOLDER_KEY, ASSET_RETAINED_KEY } from 'src/ts/studio/assets/assetOwnerKeys'
import {
    gzipMtimeOf, maskedSha256, sha256Hex, withoutGzipMtime,
    type ArchiveManifest, type CaseEntry, type ManifestCase, type ManifestUnit, type UnitRole,
} from 'src/ts/process/tests/archiveCapture/archiveFixtures'

type Slot = character | groupChat

//#region configuration

/** Read before the clock is faked: the wall-clock time the fixture files were written. */
const CAPTURE_TIME = new Date().toISOString()
const SYSTEM_TIME = Date.UTC(2026, 10, 21, 12, 0, 0)
const ACTIVE = process.env.ARCHIVE_CAPTURE_CONFIG === '1'
const WRITE_MODE = process.env.ARCHIVE_CAPTURE_WRITE === '1'
const REPO_ROOT = process.cwd()
const FIXTURE_DIR = path.join(REPO_ROOT, 'src/ts/process/tests/archiveCapture')
const OUT_DIR = path.resolve(process.env.ARCHIVE_CAPTURE_OUT ?? FIXTURE_DIR)
const VERIFY_DIR = path.resolve(process.env.ARCHIVE_CAPTURE_VERIFY_AGAINST ?? FIXTURE_DIR)
const COMMAND = 'npx vitest run --config Agents/Tools/vitest.archiveCapture.config.ts'
const CONFIG_FILE = 'Agents/Tools/vitest.archiveCapture.config.ts'
const HARNESS_FILES = ['Agents/Tools/save-gen/archiveCapture.svelte.harness.ts']

/** The modules and values replaced in the capture world. The card cases (C5 to C9) also replace the importer's neighbours. */
const STAND_INS = [
    'page byte store: an in-memory map behind the real coldstorage.svelte, through createForageBackedStore',
    'platform flags: isTauri false, isNodeServer false, isIOS false (web key layout coldstorage/<key>)',
    'uuid v4: a counter, set per case',
    'clock: Date faked to systemTime (fflate worker clock is not faked; the gzip MTIME field is masked when comparing)',
    'UI and alerts: src/ts/alert, src/ts/stores.svelte (DBState is a $state object), src/ts/util',
    'hasher (identity), parseMarkdownSafe, compressImage, getImageType, reencodeImage',
    'saveAsset, saveAssetFromPieces and the rest of globalApi.svelte',
    'decodeRPack, encodeRPack, convertExternalLorebook, updateInlayScreen, PngChunk, translateHTML',
    'interchangeability, chatOrigin, avatarThumb, upstreamAgreement',
    'database.svelte (partial: getDatabase, setDatabase, presetTemplate and the character accessors)',
    'consequence: asset paths and image fields inside the card-import units (C5 to C9) are mock-produced opaque strings',
]

//#endregion

//#region cases

const enc = new TextEncoder()
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const FOLDER_VALUE = { v: 1, additional: { order: ['Faces', 'Poses'], of: [['smile', 'Faces'], ['wave', 'Poses']] } }
const RETAINED_VALUE = ['assets/' + 'ab'.repeat(32) + '.png', 'assets/' + 'cd'.repeat(32) + '.png']

const unitKeyOf = (n: number): string => '00000000-0000-4000-8000-' + (0xc0 + n).toString(16).padStart(12, '0')
const CHAT_KEY = '00000000-0000-4000-8000-0000000000e1'

interface CaseUnit {
    role: UnitRole
    key: string
}

interface CaseOutput {
    id: string
    chaId: string
    kind: ManifestCase['kind']
    entry: CaseEntry
    sourceKind: ManifestCase['sourceKind']
    source: unknown
    stub: unknown
    chatKeys: string[]
    units: CaseUnit[]
}

function fullCharacter(chaId: string, extra: Record<string, unknown> = {}): character {
    return {
        type: 'character',
        name: 'Alice',
        image: 'assets/alice.png',
        chaId,
        chatPage: 0,
        creatorNotes: 'A short note',
        tags: ['a'],
        creator: 'Top',
        chats: [{ id: 'c1', name: 'One', note: '', localLore: [], message: [{ role: 'user', data: 'hello', time: 1 }] }],
        globalLore: [],
        ...extra,
    } as unknown as character
}

/** A character that is in the list as a full object, as a restored or never archived one is. */
function pushLoaded(cha: Slot): character {
    DBState.db.characters.push(cha)
    return DBState.db.characters[DBState.db.characters.length - 1] as unknown as character
}

async function archive(target: ArchiveTarget, key: string): Promise<{ index: number, chaId: string, stub: unknown }> {
    const result = await archiveCharacterNow(target, { newUnitKey: () => key })
    if (result.ok === false) {
        throw new Error(`the writer refused: ${result.reason}`)
    }
    return { index: result.index, chaId: result.chaId, stub: clone(DBState.db.characters[result.index]) }
}

const v2Card = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: { name: 'Two', description: 'd', personality: 'p', scenario: 's', first_mes: 'hi', mes_example: '', creator_notes: 'n', system_prompt: '', post_history_instructions: 'after', alternate_greetings: ['a'], tags: ['x'], creator: 'me', character_version: '1', extensions: { risuai: {} } },
}
const v3Card = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: { name: 'Three', description: 'd', first_mes: 'hi', character_version: '1', extensions: { risuai: {} }, assets: [], tags: ['y'], creator: 'me' },
}
const tavernCard = { name: 'Tav', description: 'd', first_mes: 'hi' }
const ownerCard = { spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'Field Holder', description: 'd', first_mes: 'hi', character_version: '1', extensions: { risuai: {} } } }

async function importedCard(id: string, card: unknown): Promise<CaseOutput> {
    const index = await importCharacterProcess({ name: 'card.json', data: enc.encode(JSON.stringify(card)), archive: true }) as number
    const stub = DBState.db.characters[index] as unknown as character
    if (typeof stub.coldstorage !== 'string') {
        throw new Error(`${id}: the import did not archive the card`)
    }
    return {
        id, chaId: stub.chaId, kind: 'import', entry: 'card-import', sourceKind: 'card', source: card,
        stub: clone(stub), chatKeys: [], units: [{ role: 'unit', key: stub.coldstorage }],
    }
}

/** The character the real importer builds from a v3 card, with both owner fields set the way the feature sets them. */
async function importedWithOwnerFields(extra: Record<string, unknown>): Promise<character> {
    const outcome = await importCharacterFile({ name: 'card.json', data: enc.encode(JSON.stringify(ownerCard)) })
    if (outcome.kind !== 'imported') {
        throw new Error('the owner-field card was not imported')
    }
    const live = DBState.db.characters[0] as unknown as Record<string, unknown>
    const extentions = (live.extentions ?? {}) as Record<string, unknown>
    Object.assign(extentions, { [ASSET_FOLDER_KEY]: clone(FOLDER_VALUE) })
    Object.assign(live, { extentions, [ASSET_RETAINED_KEY]: clone(RETAINED_VALUE), ...extra })
    return live as unknown as character
}

type CaseRunner = () => Promise<CaseOutput>

const CASES: Array<{ id: string, run: CaseRunner }> = [
    {
        id: 'new-alice',
        run: async () => {
            const original = fullCharacter('cha-new-alice')
            const source = clone(original)
            const result = await archive({ kind: 'new', character: original }, unitKeyOf(1))
            return { id: 'new-alice', chaId: result.chaId, kind: 'new', entry: 'engine-new', sourceKind: 'character', source, stub: result.stub, chatKeys: [], units: [{ role: 'unit', key: unitKeyOf(1) }] }
        },
    },
    {
        id: 'loaded-edited',
        run: async () => {
            const live = pushLoaded(fullCharacter('cha-loaded-edited'))
            live.name = 'Alice edited'
            live.creatorNotes = 'An edited note'
            live.chats.push({ id: 'c2', name: 'Two', note: '', localLore: [], message: [{ role: 'user', data: 'again', time: 2 }] } as never)
            live.trashTime = 1234
            delete live.trashTime
            const source = clone(live)
            const result = await archive({ kind: 'loaded', character: live, previousUnitKey: 'older-unit' }, unitKeyOf(2))
            return { id: 'loaded-edited', chaId: result.chaId, kind: 'loaded', entry: 'engine-loaded', sourceKind: 'character', source, stub: result.stub, chatKeys: [], units: [{ role: 'unit', key: unitKeyOf(2) }] }
        },
    },
    {
        id: 'loaded-trashed',
        run: async () => {
            const live = pushLoaded(fullCharacter('cha-loaded-trashed', { trashTime: SYSTEM_TIME }))
            const source = clone(live)
            const result = await archive({ kind: 'loaded', character: live }, unitKeyOf(3))
            return { id: 'loaded-trashed', chaId: result.chaId, kind: 'loaded', entry: 'engine-loaded', sourceKind: 'character', source, stub: result.stub, chatKeys: [], units: [{ role: 'unit', key: unitKeyOf(3) }] }
        },
    },
    {
        id: 'rearchived',
        run: async () => {
            const first = await archive({ kind: 'new', character: fullCharacter('cha-rearchived') }, unitKeyOf(4))
            // The upstream model's open: the slot takes the unit's character wholesale.
            const read = await readColdStorageItem(unitKeyOf(4))
            if (read.status !== 'ok') {
                throw new Error('the first unit did not read back')
            }
            DBState.db.characters[first.index] = (read.value as { character: character }).character as never
            const live = DBState.db.characters[first.index] as unknown as character
            live.name = 'Alice edited'
            const source = clone(live)
            const second = await archive({ kind: 'loaded', character: live, previousUnitKey: unitKeyOf(4) }, unitKeyOf(5))
            return {
                id: 'rearchived', chaId: second.chaId, kind: 'sequence', entry: 'engine-sequence', sourceKind: 'character', source, stub: second.stub, chatKeys: [],
                units: [{ role: 'unit1', key: unitKeyOf(4) }, { role: 'unit2', key: unitKeyOf(5) }],
            }
        },
    },
    { id: 'import-v2', run: () => importedCard('import-v2', v2Card) },
    { id: 'import-v3', run: () => importedCard('import-v3', v3Card) },
    { id: 'import-tavern', run: () => importedCard('import-tavern', tavernCard) },
    {
        id: 'owner-fields',
        run: async () => {
            const live = await importedWithOwnerFields({})
            const source = clone(live)
            const result = await archive({ kind: 'loaded', character: live }, unitKeyOf(9))
            return { id: 'owner-fields', chaId: result.chaId, kind: 'loaded', entry: 'engine-loaded', sourceKind: 'character', source, stub: result.stub, chatKeys: [], units: [{ role: 'unit', key: unitKeyOf(9) }] }
        },
    },
    {
        id: 'render-when-complete',
        run: async () => {
            const live = await importedWithOwnerFields({ risutanium_render_when_complete: true })
            const source = clone(live)
            const result = await archive({ kind: 'loaded', character: live }, unitKeyOf(10))
            return { id: 'render-when-complete', chaId: result.chaId, kind: 'loaded', entry: 'engine-loaded', sourceKind: 'character', source, stub: result.stub, chatKeys: [], units: [{ role: 'unit', key: unitKeyOf(10) }] }
        },
    },
    {
        id: 'group-new',
        run: async () => {
            const group = {
                type: 'group',
                name: 'Trio',
                image: '',
                chaId: 'cha-group-new',
                characters: ['cha-new-alice', 'cha-loaded-edited'],
                creatorNotes: 'A group',
                chatPage: 0,
                chats: [{ id: 'g1', name: 'One', note: '', localLore: [], message: [{ role: 'user', data: 'hi group', time: 1 }] }],
            } as unknown as groupChat
            const source = clone(group)
            const result = await archive({ kind: 'new', character: group }, unitKeyOf(11))
            return { id: 'group-new', chaId: result.chaId, kind: 'new', entry: 'engine-new', sourceKind: 'character', source, stub: result.stub, chatKeys: [], units: [{ role: 'unit', key: unitKeyOf(11) }] }
        },
    },
    {
        id: 'pointer-chat',
        run: async () => {
            const written = await setColdStorageItem(CHAT_KEY, { message: [{ role: 'char', data: 'archived first message', time: 1 }], localLore: [] })
            if (!written) {
                throw new Error('the chat unit was not written')
            }
            const original = fullCharacter('cha-pointer-chat', {
                chats: [{
                    id: 'c1', name: 'One', note: '', localLore: [],
                    message: [{ role: 'char', data: coldStorageHeader + CHAT_KEY, time: 1 }, { role: 'user', data: 'tail', time: 2 }],
                }],
            })
            const source = clone(original)
            const result = await archive({ kind: 'new', character: original }, unitKeyOf(12))
            return {
                id: 'pointer-chat', chaId: result.chaId, kind: 'new', entry: 'engine-new', sourceKind: 'character', source, stub: result.stub, chatKeys: [CHAT_KEY],
                units: [{ role: 'chat', key: CHAT_KEY }, { role: 'unit', key: unitKeyOf(12) }],
            }
        },
    },
]

function installDb(): void {
    DBState.db = {
        formatversion: 5,
        archiveCharacters: true,
        plugins: [],
        characters: [],
        modules: [],
        statics: { imports: 0 },
        goCharacterOnImport: false,
        pluginCustomStorage: {},
    } as unknown as Database
}

function resetWorld(caseNumber: number): void {
    h.units.clear()
    h.uuid = caseNumber * 100
    resetPutBackForTest()
    resetRetainedForTest()
    resetRestoredBytesForTest()
    resetCharacterSaveMarksForTest()
    resetBootArchiveStateForTest()
    noteBootArchiveSession(true)
    installDb()
}

//#endregion

//#region capture

function unitFileOf(id: string, role: UnitRole): string {
    return role === 'unit' ? `${id}.unit.gz` : role === 'chat' ? `${id}.chat.unit.gz` : `${id}.${role}.gz`
}

interface Captured {
    /** File name to its exact content: a string for JSON, bytes for a gzip unit. */
    files: Map<string, string | Uint8Array>
    manifest: ArchiveManifest
}

function git(args: string[]): string {
    return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' })
}

/** Test, helper and harness paths are not production code. */
const NON_PRODUCTION = /(^|\/)tests\/|\.test\.ts$|\.test-helpers|\.harness\.ts$/

function productionPathsOf(paths: string[]): string[] {
    return paths.filter((file) => file !== '' && !NON_PRODUCTION.test(file))
}

function productionDirty(): string[] {
    const lines = git(['status', '--porcelain', '-uall', '--', 'src']).split('\n').filter((line) => line.trim() !== '')
    return productionPathsOf(lines.map((line) => line.slice(3).split(' -> ').pop() as string)).sort()
}

function fflateVersion(): string {
    return (JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'node_modules/fflate/package.json'), 'utf8')) as { version: string }).version
}

const jsonText = (value: unknown): string => JSON.stringify(value, null, 2) + '\n'

async function captureAll(): Promise<Captured> {
    const files = new Map<string, string | Uint8Array>()
    const cases: ManifestCase[] = []
    const captureUnits: ArchiveManifest['capture']['units'] = {}
    for (let i = 0; i < CASES.length; i++) {
        resetWorld(i + 1)
        const output = await CASES[i].run()
        const sourceFile = `${output.id}.source.json`
        const stubFile = `${output.id}.stub.json`
        files.set(sourceFile, jsonText(output.source))
        files.set(stubFile, jsonText(output.stub))
        const units: ManifestUnit[] = []
        for (const unit of output.units) {
            const storeKey = coldUnitStoreKey(unit.key)
            const bytes = h.units.get(storeKey)
            if (bytes === undefined) {
                throw new Error(`${output.id}: the store holds no unit ${unit.key}`)
            }
            const file = unitFileOf(output.id, unit.role)
            files.set(file, bytes)
            units.push({
                role: unit.role, key: unit.key, storeKey, file, byteLength: bytes.length,
                maskedSha256: maskedSha256(bytes), payloadSha256: sha256Hex(decompressSync(bytes)),
            })
            captureUnits[file] = { sha256: sha256Hex(bytes), gzipMtime: gzipMtimeOf(bytes) }
        }
        cases.push({ id: output.id, chaId: output.chaId, kind: output.kind, entry: output.entry, sourceKind: output.sourceKind, sourceFile, stubFile, chatKeys: output.chatKeys, units })
    }
    const manifest: ArchiveManifest = {
        content: {
            generator: { files: HARNESS_FILES, command: COMMAND, config: CONFIG_FILE },
            fflateVersion: fflateVersion(),
            platform: 'web',
            systemTime: SYSTEM_TIME,
            standIns: STAND_INS,
            cases,
        },
        capture: { baseCommit: git(['rev-parse', 'HEAD']).trim(), productionDirty: productionDirty(), time: CAPTURE_TIME, units: captureUnits },
    }
    files.set('manifest.json', jsonText(manifest))
    return { files, manifest }
}

//#endregion

//#region write and verify

function writeFixtures(captured: Captured): void {
    fs.mkdirSync(OUT_DIR, { recursive: true })
    for (const [name, content] of captured.files) {
        fs.writeFileSync(path.join(OUT_DIR, name), content)
    }
}

const FIXTURE_FILE = /\.(source|stub)\.json$|\.gz$/

function filesOf(dir: string): string[] {
    return fs.readdirSync(dir).filter((name) => FIXTURE_FILE.test(name)).sort()
}

function expectContentEqual(actual: unknown, expected: unknown): void {
    expect(actual).toEqual(expected)
}

function verifyAgainst(captured: Captured, dir: string): void {
    // V1: the same files, and the same JSON.
    const names = [...captured.files.keys()].filter((name) => FIXTURE_FILE.test(name)).sort()
    expect(filesOf(dir)).toEqual(names)
    for (const name of names) {
        const mine = captured.files.get(name) as string | Uint8Array
        const stored = fs.readFileSync(path.join(dir, name))
        if (typeof mine === 'string') {
            expect(JSON.parse(stored.toString('utf8')), name).toEqual(JSON.parse(mine))
            continue
        }
        // V2: the same gzip bytes apart from the MTIME field, and the same payload.
        expect(stored.length, `${name} length`).toBe(mine.length)
        expect(Buffer.from(withoutGzipMtime(new Uint8Array(stored))).equals(Buffer.from(withoutGzipMtime(mine))), `${name} bytes outside MTIME`).toBe(true)
        expect(Buffer.from(decompressSync(new Uint8Array(stored))).equals(Buffer.from(decompressSync(mine))), `${name} payload`).toBe(true)
    }
    // V3: the manifest's content block.
    const stored = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as ArchiveManifest
    expectContentEqual(stored.content, captured.manifest.content)
    // V4: the production tree is clean, unchanged since the capture, and the capture's base is an ancestor.
    const head = git(['rev-parse', 'HEAD']).trim()
    const dirty = productionDirty()
    const changedSinceCapture = productionPathsOf(git(['diff', '--name-only', stored.capture.baseCommit, 'HEAD', '--', 'src']).split('\n'))
    process.stdout.write(`verify.head ${head}\nverify.baseCommit ${stored.capture.baseCommit}\nverify.productionDirty ${JSON.stringify(dirty)}\nverify.productionChangedSinceCapture ${JSON.stringify(changedSinceCapture)}\n`)
    expect(dirty).toEqual([])
    expect(changedSinceCapture).toEqual([])
    expect(() => git(['merge-base', '--is-ancestor', stored.capture.baseCommit, 'HEAD'])).not.toThrow()
}

//#endregion

describe.skipIf(!ACTIVE)('archive capture', () => {
    beforeAll(() => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(SYSTEM_TIME)
        vi.spyOn(console, 'log').mockImplementation(() => {})
        vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterAll(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    test(WRITE_MODE ? 'writes the fixtures' : 'verifies the fixtures', async () => {
        const captured = await captureAll()
        if (WRITE_MODE) {
            writeFixtures(captured)
            return
        }
        verifyAgainst(captured, VERIFY_DIR)

    }, 120000)
})
