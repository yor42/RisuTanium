/**
 * Integrity guards over the committed capture of the one-character archive writer (`archiveCapture/README.md`): the
 * manifest agrees with the bytes, every unit decodes through the real reader to the character the stub names, the
 * test-support `buildColdStub` rebuilds each captured stub, and the legacy resolve brings a captured stub back as the
 * full character.
 *
 * Every test here is a COMPATIBILITY GUARD: it holds on the committed bytes and fails when a fixture file, the manifest,
 * the reader's decode or the stub shape drifts. None of it proves the writer itself, which no longer exists after the
 * capture; provenance was proven once, at the capture (`archiveCapture/README.md`, "Provenance"). The page's byte store
 * underneath the real reader is a stand-in.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
//#region module mocks

const platformState = vi.hoisted(() => ({ isTauri: false }))
const forageMem = vi.hoisted(() => new Map<string, Uint8Array>())
/** The page store's content (`coldstorage/<key>`) and every key read from it, in order. */
const unitStore = vi.hoisted(() => new Map<string, Uint8Array>())
const unitReadLog = vi.hoisted(() => [] as string[])

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
    get isTauri() { return platformState.isTauri },
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => {
        throw new Error('no live database in tests')
    }),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('../../stores.svelte'), () => {
    const state = { db: {} as unknown as Database }
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { state: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        botMakerMode: writable(false),
        loadedStore: writable(false),
        LoadingStatusState: { text: '' },
        ReloadGUIPointer: writable(0),
        bodyIntercepterStore: writable(null),
        savingStoppedReason: writable(null),
        CharEmotion: writable({}),
        MobileGUIStack: writable([]),
        OpenRealmStore: writable(false),
        frozenSaveKeysStore: writable([]),
    } as unknown as typeof import('../../stores.svelte')
})

vi.mock(import('../index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('../index.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertWait: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(),
    alertAddCharacter: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => {}),
}))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn(async () => {}),
    sleepForever: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((p: string) => p),
    invoke: vi.fn(async () => undefined),
}))

vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
    basename: vi.fn(async (p: string) => p.split('/').pop()),
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
    open: vi.fn(async () => {}),
}))

vi.mock('src/ts/vendor/streamSaver', () => ({
    default: {
        useBlobFallback: false,
        createWriteStream: () => ({
            ready: Promise.resolve(),
            writable: {
                getWriter: () => ({
                    write: async () => { },
                    close: async () => { },
                }),
            },
        }),
    },
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({
        listen: vi.fn(),
        setTitle: vi.fn(),
    })),
}))

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => {}),
}))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    parseMarkdownSafe: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    hubURL: 'https://example.invalid',
    importCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    registerDbChangeEffects: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))

vi.mock(import('src/ts/storage/autoStorage'), () => ({
    AutoStorage: class {
        realStorage: unknown = undefined
        async getItem(key: string) { return forageMem.get(key) ?? null }
        async setItem(key: string, value: Uint8Array) { forageMem.set(key, value) }
        async keys() { return Array.from(forageMem.keys()) }
        async removeItem(key: string) { forageMem.delete(key) }
    },
}) as unknown as typeof import('src/ts/storage/autoStorage'))

vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { createForageBackedStore } = await import('src/ts/storage/tests/forageBackedStore')
    const store = createForageBackedStore({
        getItem: async (key) => { unitReadLog.push(key); return unitStore.get(key) ?? null },
        setItem: async (key, value) => { unitStore.set(key, value) },
        keys: async () => Array.from(unitStore.keys()),
        removeItem: async (key) => { unitStore.delete(key) },
    })
    return { getAppStore: async () => store } as unknown as typeof import('src/ts/storage/store/appStore')
})

vi.mock(import('src/ts/gui/animation'), () => ({
    updateAnimationSpeed: vi.fn(),
}) as unknown as typeof import('src/ts/gui/animation'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async () => null),
}))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async () => vi.fn()),
}))

vi.mock(import('src/ts/observer.svelte'), () => ({
    startObserveDom: vi.fn(),
}) as unknown as typeof import('src/ts/observer.svelte'))

vi.mock(import('src/ts/gui/guisize'), () => ({
    updateGuisize: vi.fn(),
}) as unknown as typeof import('src/ts/gui/guisize'))

vi.mock(import('src/ts/characters'), () => ({
    updateLorebooks: vi.fn((v: unknown) => v),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/hotkey'), () => ({
    initMobileGesture: vi.fn(),
}) as unknown as typeof import('src/ts/hotkey'))

vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: vi.fn(async () => new Response(null, { status: 404 })),
}))

vi.mock(import('src/ts/process/modules'), () => ({
    moduleUpdate: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0 },
    readDir: vi.fn(async () => []),
    readFile: vi.fn(async () => {
        throw new Error('the Tauri backend is not under test')
    }),
    writeFile: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => {}),
}))

//#endregion

//#region legacy OPFS unit files stand-in (navigator.storage); no test here places one, so a read falls through to "not found"

const opfsStore = new Map<string, Uint8Array>()

class MockNotFoundError extends Error {
    name = 'NotFoundError'
}

const mockDirectoryHandle = {
    async getFileHandle(name: string) {
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
import { readColdStorageItem } from '../coldstorage.svelte'
import { buildColdStub } from '../coldCharacter'
import { coldStorageHeader } from '../coldstorageData'
import { resolveLegacyTree } from 'src/ts/storage/store2/legacy/resolve'
import type { IncompleteItem } from 'src/ts/storage/store2/legacy/resolve'
import { readerOver, type StoredUnit } from 'src/ts/storage/tests/store2/legacyFixtures'
import type { character, Chat } from 'src/ts/storage/database.svelte'
import {
    gzipMtimeOf, loadArchiveCase, manifest, maskedSha256, placeUnits, sha256Hex, unitCharacterOf,
    type ArchivedCase, type CapturedUnit,
} from './archiveCapture/archiveFixtures'
import { decompressSync } from 'fflate'

const CASE_IDS = manifest().content.cases.map((entry) => entry.id)

beforeEach(() => {
    unitStore.clear()
    unitReadLog.length = 0
})

function characterUnits(archived: ArchivedCase): CapturedUnit[] {
    return archived.units.filter((unit) => unit.role !== 'chat')
}

describe('the manifest agrees with the committed bytes', () => {
    test('guard: capture was taken on a clean production tree and every case has its own character id', () => {
        const { content, capture } = manifest()

        expect(capture.productionDirty).toEqual([])
        const chaIds = content.cases.map((entry) => entry.chaId)
        expect(new Set(chaIds).size).toBe(chaIds.length)
        expect(content.cases.length).toBe(11)
    })

    test.each(CASE_IDS)('guard: every unit of %s matches its recorded hashes, header MTIME and length', (id) => {
        const { content, capture } = manifest()
        const archived = loadArchiveCase(id)

        expect(archived.units.length).toBeGreaterThan(0)
        for (const unit of archived.units) {
            const recorded = capture.units[unit.file]
            expect(recorded, unit.file).toBeDefined()
            expect(sha256Hex(unit.bytes), unit.file).toBe(recorded.sha256)
            expect(gzipMtimeOf(unit.bytes), unit.file).toBe(recorded.gzipMtime)
            expect(unit.bytes.length, unit.file).toBe(unit.byteLength)
            expect(maskedSha256(unit.bytes), unit.file).toBe(unit.maskedSha256)
            expect(sha256Hex(decompressSync(unit.bytes)), unit.file).toBe(unit.payloadSha256)
        }
        expect(content.cases.find((entry) => entry.id === id)?.units.map((unit) => unit.file)).toEqual(archived.units.map((unit) => unit.file))
    })

    test.each(CASE_IDS)('guard: %s reads through the real reader, its character unit holds the stub\'s character, and the stub points at its unit', async (id) => {
        const archived = loadArchiveCase(id)
        placeUnits(unitStore, archived.units)
        const stub = archived.stub as character

        expect(stub.coldVersion).toBe(3)
        expect(stub.coldStoragedChats).toEqual(archived.chatKeys)
        expect(archived.units.some((unit) => unit.key === stub.coldstorage)).toBe(true)
        for (const unit of archived.units) {
            const read = await readColdStorageItem(unit.key)
            expect(read.status, unit.file).toBe('ok')
            if (read.status !== 'ok') {
                continue
            }
            if (unit.role === 'chat') {
                const chat = read.value as { message?: unknown, localLore?: unknown }
                expect(Array.isArray(chat.message)).toBe(true)
                expect(chat.localLore).toEqual([])
                continue
            }
            const unitCharacter = (read.value as { character: character }).character
            expect(unitCharacter.chaId).toBe(stub.chaId)
            expect(unitCharacter.chaId).toBe(archived.chaId)
            expect(unitCharacter.trashTime).toBeUndefined()
        }
    })
})

describe('the test-support stub builder rebuilds each captured stub', () => {
    /** The volatile fields of the one dummy chat: its id and its message time. */
    function withoutDummyChatVolatiles(stub: character): character {
        const copy = JSON.parse(JSON.stringify(stub)) as character
        delete (copy.chats[0] as Partial<Chat>).id
        delete (copy.chats[0].message[0] as { time?: number }).time
        return copy
    }

    test.each(CASE_IDS)('guard: buildColdStub on the source of %s equals the captured stub apart from the dummy chat\'s id and time', (id) => {
        const archived = loadArchiveCase(id)
        // An engine case hands the writer `source`; a card import hands it the character the import formatted, which is the unit's.
        const input = archived.sourceKind === 'character'
            ? archived.source
            : unitCharacterOf(characterUnits(archived)[0])

        const rebuilt = buildColdStub(input as character, (archived.stub as character).coldstorage as string, archived.chatKeys)

        expect(withoutDummyChatVolatiles(rebuilt)).toEqual(withoutDummyChatVolatiles(archived.stub as character))
    })
})

describe('the legacy resolve brings a captured stub back as the full character', () => {
    async function resolved(id: string): Promise<{ archived: ArchivedCase, character: character, incomplete: IncompleteItem[] }> {
        const archived = loadArchiveCase(id)
        placeUnits(unitStore, archived.units)
        const units = new Map<string, StoredUnit>()
        for (const unit of archived.units) {
            const read = await readColdStorageItem(unit.key)
            if (read.status !== 'ok') {
                throw new Error(`${unit.file} did not read`)
            }
            units.set(unit.key, { status: 'ok', value: read.value })
        }
        const tree = { characters: [JSON.parse(JSON.stringify(archived.stub))], pluginCustomStorage: {} } as unknown as Database
        const result = await resolveLegacyTree(tree, readerOver(units))
        return { archived, character: result.database.characters[0] as unknown as character, incomplete: result.incomplete }
    }

    test('guard: a new archive resolves to the unit\'s full character', async () => {
        const { archived, character: full, incomplete } = await resolved('new-alice')
        const unit = unitCharacterOf(archived.units[0]) as character

        expect(incomplete).toEqual([])
        expect(full.coldstorage).toBeUndefined()
        expect(full.chaId).toBe(unit.chaId)
        expect(full.name).toBe(unit.name)
        expect(full.chats).toEqual(unit.chats)
    })

    test('guard: a trashed archive resolves with the stub\'s trashTime', async () => {
        const { archived, character: full, incomplete } = await resolved('loaded-trashed')

        expect(incomplete).toEqual([])
        expect(full.chaId).toBe(archived.chaId)
        expect(full.trashTime).toBe((archived.stub as character).trashTime)
        expect(full.trashTime).toBeGreaterThan(0)
    })

    test('guard: a character whose chat is its own unit resolves with the chat unit\'s messages before the tail', async () => {
        const { archived, character: full, incomplete } = await resolved('pointer-chat')

        expect(incomplete).toEqual([])
        expect(full.chaId).toBe(archived.chaId)
        expect(full.chats).toHaveLength(1)
        expect(full.chats[0].message.map((message) => message.data)).toEqual(['archived first message', 'tail'])
        expect(JSON.stringify(full)).not.toContain(coldStorageHeader)
    })
})