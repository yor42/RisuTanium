/**
 * Compatibility guard (passes before and after UI-S1a): what the new chat shell's modules do to a
 * chat is exactly what the old shell's paths do, so a `.bin` exported afterwards is the same bytes
 * and carries no key upstream does not know.
 *
 * The export is the real `SaveLocalBackup` over an in-memory page store, the same setup that wrote
 * the `fork-*.bin` goldens (`Agents/Tools/save-gen/binGoldens.harness.ts`). The shell side runs the
 * real `deleteNow` (`messageActions.svelte.ts`) and the real composer `send` (`composerActions.svelte.ts`
 * with the real `sendCharacterMessage`); the reference side applies the old shell's own operations to
 * an identical chat (`withSupaRepoint` around a plain splice, a plain push). The two exports must be
 * byte-equal, and the golden files must still hash to the values recorded next to them.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Database, Chat, Message } from 'src/ts/storage/database.svelte'

//#region module mocks

const platformBox = vi.hoisted(() => {
    // globalApi.svelte.ts reads navigator.locks once, at module evaluation.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: false }
})

const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as unknown as Database))
const backupSink = vi.hoisted(() => ({ writes: [] as Uint8Array[] }))
const sendChatMock = vi.hoisted(() => vi.fn(async () => true))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
            keys: vi.fn(async () => []),
        }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return platformBox.isTauri },
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0, Download: 1 },
    writeFile: vi.fn(async () => { }),
    readFile: vi.fn(async () => { throw new Error('the Tauri backend is not under test') }),
    readDir: vi.fn(async () => []),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => { }),
    remove: vi.fn(async () => { }),
}))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn(async () => { }) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(async () => 'backup-output.bin') }))
vi.mock('src/ts/vendor/streamSaver', () => ({
    default: {
        useBlobFallback: false,
        createWriteStream: () => ({
            ready: Promise.resolve(),
            writable: {
                getWriter: () => ({
                    write: async (chunk: Uint8Array) => { backupSink.writes.push(chunk.slice()) },
                    close: async () => { },
                }),
            },
        }),
    },
}))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: getDatabaseMock,
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
    getCurrentChat: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} as unknown as Database },
    selectedCharID: writable(-1),
    selIdState: { selId: -1 },
    alertStore: writable({ type: 'none', msg: '' }),
    MobileGUI: writable(false),
    botMakerMode: writable(false),
    loadedStore: writable(false),
    LoadingStatusState: { text: '' },
    ReloadGUIPointer: writable(0),
    ReloadChatPointer: writable({} as Record<number, number>),
    CurrentTriggerIdStore: writable(null),
    bodyIntercepterStore: writable(null),
    savingStoppedReason: writable(null),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
    sendChat: sendChatMock,
}) as unknown as typeof import('src/ts/process/index.svelte'))

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
    waitAlert: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn(async () => { }),
    sleepForever: vi.fn(async () => { }),
    capitalize: vi.fn((value: string) => value),
    getUserName: vi.fn(() => 'User'),
    getUserIcon: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/util'))

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: vi.fn((p: string) => p), invoke: vi.fn(async () => undefined) }))
vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
    basename: vi.fn(async (p: string) => p.split('/').pop()),
}))
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn(async () => { }) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })) }))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn(async () => new Response(null, { status: 404 })) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }))
vi.mock(import('src/ts/update'), () => ({ checkRisuUpdate: vi.fn(async () => { }) }))
vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({ loadPlugins: vi.fn(async () => { }) }) as unknown as typeof import('src/ts/plugins/plugins.svelte'))
vi.mock(import('src/ts/parser/parser.svelte'), () => ({ hasher: vi.fn((s: string) => s) }) as unknown as typeof import('src/ts/parser/parser.svelte'))
vi.mock(import('src/ts/characterCards'), () => ({ characterURLImport: vi.fn(), hubURL: 'https://example.invalid' }) as unknown as typeof import('src/ts/characterCards'))
vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({ registerDbChangeEffects: vi.fn() }) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))
vi.mock(import('src/ts/storage/autoStorage'), () => ({
    AutoStorage: class {
        realStorage: unknown = undefined
        getItem = vi.fn(async () => null)
        setItem = vi.fn(async () => { })
        keys = vi.fn(async () => [])
        removeItem = vi.fn(async () => { })
    },
}) as unknown as typeof import('src/ts/storage/autoStorage'))
vi.mock(import('src/ts/gui/animation'), () => ({ updateAnimationSpeed: vi.fn() }) as unknown as typeof import('src/ts/gui/animation'))
vi.mock(import('src/ts/gui/colorscheme'), () => ({ updateColorScheme: vi.fn(), updateTextThemeAndCSS: vi.fn() }) as unknown as typeof import('src/ts/gui/colorscheme'))
vi.mock(import('src/ts/observer.svelte'), () => ({ startObserveDom: vi.fn() }) as unknown as typeof import('src/ts/observer.svelte'))
vi.mock(import('src/ts/gui/guisize'), () => ({ updateGuisize: vi.fn() }) as unknown as typeof import('src/ts/gui/guisize'))
vi.mock(import('src/ts/characters'), () => ({ updateLorebooks: vi.fn((v: unknown) => v) }) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/hotkey'), () => ({ initMobileGesture: vi.fn() }) as unknown as typeof import('src/ts/hotkey'))
vi.mock(import('src/ts/process/modules'), () => ({ moduleUpdate: vi.fn(async () => { }) }) as unknown as typeof import('src/ts/process/modules'))

// What the shell's send and delete modules import beyond the export graph; none of it is read on these paths.
vi.mock('src/ts/process/command', () => ({ processMultiCommand: vi.fn(async () => false) }))
vi.mock('src/ts/process/triggers', () => ({ runTrigger: vi.fn(async () => undefined) }))
vi.mock('src/ts/process/scripts', () => ({ processScript: vi.fn(async (_char: unknown, text: string) => text) }))
vi.mock('src/ts/process/scriptings', () => ({ runLuaButtonTrigger: vi.fn(), runLuaInteractionTrigger: vi.fn() }))
vi.mock('src/ts/process/tts', () => ({ sayTTS: vi.fn(), stopTTS: vi.fn() }))
vi.mock('src/ts/process/ttsSpeechText', () => ({ speakerSpeechText: vi.fn() }))
vi.mock('src/ts/model/modellist', () => ({ getModelInfo: vi.fn() }))
vi.mock('src/ts/chatCopy', () => ({ copyPlainText: vi.fn(), stripThoughtsForCopy: vi.fn((text: string) => text) }))
vi.mock('src/ts/chatCard', () => ({ captureCardTheme: vi.fn(), noteNewerPlainCopy: vi.fn(), startCardCopy: vi.fn() }))
vi.mock('src/ts/process/moduleEnsure', () => ({ ensureModulesOrAlert: vi.fn(async () => true) }))
vi.mock('src/ts/process/moduleRefList', () => ({ hasModuleStubs: vi.fn(() => false) }))
vi.mock('src/ts/translator/translator', () => ({ isExpTranslator: vi.fn(() => false), translate: vi.fn(async () => '') }))

class MockNotFoundError extends Error {
    name = 'NotFoundError'
}

// No legacy OPFS unit file exists: every read falls through to "not found".
Object.defineProperty(globalThis.navigator, 'storage', {
    configurable: true,
    value: {
        getDirectory: async () => ({
            async getFileHandle(name: string) {
                throw new MockNotFoundError('not found: ' + name)
            },
            async removeEntry() { },
            entries() {
                return {
                    [Symbol.asyncIterator]() {
                        return { async next() { return { done: true as const, value: undefined } } }
                    },
                }
            },
        }),
    },
})

//#endregion

import { SaveLocalBackup } from 'src/ts/drive/backuplocal'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { decodeRisuSave } from 'src/ts/storage/risuSave'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createForageBackedStore } from 'src/ts/storage/tests/forageBackedStore'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { deleteNow } from 'src/ts/process/messageActions.svelte'
import { send } from 'src/ts/process/composerActions.svelte'
import { withSupaRepoint } from 'src/ts/process/memory/supaResume'
import * as composerDrafts from 'src/ts/process/composerDrafts.svelte'
import { resetComposerActionsForTests } from 'src/ts/process/composerActions.svelte'

// msgpackr 1.10.1 calls `Buffer.prototype.utf8Write(string, position, 0xffffffff)` for a longer string, and the
// Node running this guard rejects a length past the buffer's end. Clamping the length to the room left changes no
// byte written; it only lets the real encoder run here (the golden generator does the same).
interface Utf8Writer {
    utf8Write(this: Uint8Array, text: string, position: number, length: number): number
}
const utf8WriterProto = Buffer.prototype as unknown as Utf8Writer
const nativeUtf8Write = utf8WriterProto.utf8Write
utf8WriterProto.utf8Write = function (text, position, length) {
    return nativeUtf8Write.call(this, text, position, Math.min(length, this.length - position))
}

//#region fixtures

const T = 1700000000000
const GOLDEN_DIR = path.resolve(process.env.BIN_GOLDENS_DIR ?? path.join(process.cwd(), 'src/ts/drive/tests/binGoldens'))

const unitMem = new Map<string, Uint8Array>()
const assetMem = new Map<string, Uint8Array>()

function message(chatId: string, role: 'user' | 'char', data: string, time: number): Message {
    return { role, data, time, chatId }
}

/** An inline character with a plain chat that carries a sibling record, as an alternatives chain leaves it. */
function buildChat(): Chat {
    return {
        id: 'chat-shell-1',
        note: '',
        name: '',
        localLore: [],
        message: [
            message('m1', 'user', 'first', T + 1),
            message('m2', 'char', 'second', T + 2),
            message('m3', 'user', 'third', T + 3),
            message('m4', 'char', 'fourth', T + 4),
            message('m5', 'user', 'fifth', T + 5),
        ],
        alt: [{ m: message('s2', 'char', 'second, other take', T + 6), p: 'm1', a: 1 }],
    } as unknown as Chat
}

function buildDatabase(chat: Chat): Database {
    return {
        characters: [{ chaId: 'cha-shell', name: 'Shell Alice', type: 'character', chatPage: 0, chats: [chat] }],
        personas: [],
        characterOrder: [],
        modules: [],
        botPresets: [],
        pluginCustomStorage: {},
    } as unknown as Database
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

/** The `database.risudat` entry of a written backup: entries are `[u32 nameLength][name][u32 dataLength][data]`. */
function databaseEntryOf(container: Uint8Array): Uint8Array {
    const view = new DataView(container.buffer, container.byteOffset, container.byteLength)
    let offset = 0
    while (offset < container.length) {
        const nameLength = view.getUint32(offset, true)
        const name = new TextDecoder().decode(container.subarray(offset + 4, offset + 4 + nameLength))
        const dataLength = view.getUint32(offset + 4 + nameLength, true)
        const start = offset + 8 + nameLength
        if (name === 'database.risudat') {
            return container.slice(start, start + dataLength)
        }
        offset = start + dataLength
    }
    throw new Error('the backup has no database entry')
}

/** The real export of `db`: the database entry's bytes. */
async function exportEntry(db: Database): Promise<Uint8Array> {
    getDatabaseMock.mockImplementation(() => db)
    backupSink.writes.length = 0
    await SaveLocalBackup()
    return databaseEntryOf(concatBytes(backupSink.writes))
}

const source = { closeMenu: () => { } }

/** The shell's modules act on the live database: delete one message, delete a range, then send one. */
async function shellSession(db: Database): Promise<void> {
    DBState.db = db
    selectedCharID.set(0)
    const owner = db.characters[0]
    const chat = owner.chats[0]
    expect(deleteNow(owner, chat, chat.message[1], 'one')).toBe(true)
    expect(deleteNow(owner, chat, chat.message[3], 'from')).toBe(true)
    composerDrafts.write({ chaId: 'cha-shell', chatId: 'chat-shell-1' }, (record) => { record.messageInput = 'hello there' })
    await send(source)
}

/** The old shell's own operations on an identical chat: a delete is `withSupaRepoint` around a splice, a send is a push. */
function oldShellSession(db: Database): void {
    const chat = db.characters[0].chats[0]
    withSupaRepoint(chat, () => { chat.message.splice(1, 1) })
    withSupaRepoint(chat, () => { chat.message.splice(3, chat.message.length - 3) })
    chat.message.push({ role: 'user', data: 'hello there', time: T })
}

//#endregion

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T)
    platformBox.isTauri = false
    backupSink.writes.length = 0
    unitMem.clear()
    assetMem.clear()
    sendChatMock.mockClear()
    composerDrafts.resetComposerDraftsForTests()
    resetComposerActionsForTests()
    injectAppStore(createForageBackedStore({
        getItem: async (key) => key.startsWith('coldstorage/') ? (unitMem.get(key) ?? null) : (assetMem.get(key) ?? null),
        setItem: async (key, value) => {
            if (key.startsWith('coldstorage/')) {
                unitMem.set(key, value)
            } else {
                assetMem.set(key, value)
            }
        },
        keys: async () => [...assetMem.keys(), ...unitMem.keys()].sort(),
        removeItem: async (key) => { unitMem.delete(key); assetMem.delete(key) },
    }))
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })
})

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    localStorage.clear()
})

describe('compatibility guard: the new shell leaves the .bin in the upstream shape', () => {
    test('a delete, a send and a range delete through the shell modules export the same bytes as the old shell path', async () => {
        const shellDb = buildDatabase(buildChat())
        await shellSession(shellDb)
        expect(sendChatMock).toHaveBeenCalledTimes(1)
        const shellBytes = await exportEntry(shellDb)

        const referenceDb = buildDatabase(buildChat())
        oldShellSession(referenceDb)
        const referenceBytes = await exportEntry(referenceDb)

        expect(Array.from(shellBytes)).toEqual(Array.from(referenceBytes))
    })

    test('the exported chat holds only keys upstream knows, on the character, the chat and every message', async () => {
        const db = buildDatabase(buildChat())
        await shellSession(db)
        const decoded = await decodeRisuSave(await exportEntry(db), { strict: true })

        const exported = decoded.characters[0]
        expect(Object.keys(exported).sort()).toEqual(['chaId', 'chatPage', 'chats', 'name', 'type'])
        const chat = exported.chats[0]
        expect(Object.keys(chat).sort()).toEqual(['id', 'localLore', 'message', 'name', 'note'])
        expect(chat.message.map((m) => m.data)).toEqual(['first', 'third', 'fourth', 'hello there'])
        expect(chat.message.slice(0, 3).map((m) => m.chatId)).toEqual(['m1', 'm3', 'm4'])
        for (const entry of chat.message) {
            const allowed = ['role', 'data', 'time', 'chatId']
            expect(Object.keys(entry).filter((key) => !allowed.includes(key))).toEqual([])
        }
    })

    test('no device-local shell state travels in the export: not the switch, not a composer draft, not the pending send', async () => {
        localStorage.setItem('risuChatShell.enabled', '1')
        composerDrafts.write({ chaId: 'cha-shell', chatId: 'chat-shell-1' }, (record) => { record.messageInput = 'DRAFT-MARKER-NOT-SENT' })
        const db = buildDatabase(buildChat())
        const entry = await exportEntry(db)
        const text = new TextDecoder('latin1').decode(entry)
        const decodedText = JSON.stringify(await decodeRisuSave(entry, { strict: true }))
        expect(text).not.toContain('risuChatShell')
        expect(decodedText).not.toContain('DRAFT-MARKER-NOT-SENT')
        expect(decodedText).not.toContain('risuChatShell')
    })

    test('TB4b: the device-local chat sort travels in no export', async () => {
        localStorage.setItem('risuChatShell.chatSort', 'manual')
        const db = buildDatabase(buildChat())
        const entry = await exportEntry(db)
        const text = new TextDecoder('latin1').decode(entry)
        const decodedText = JSON.stringify(await decodeRisuSave(entry, { strict: true }))
        expect(text).not.toContain('chatSort')
        expect(decodedText).not.toContain('chatSort')
    })

    test('the committed golden files still hash to the values recorded in their README', () => {
        const readme = fs.readFileSync(path.join(GOLDEN_DIR, 'README.md'), 'utf8')
        const recorded = [...readme.matchAll(/^([0-9A-F]{64})\s+(\S+\.bin) \((\d+) bytes\)$/gm)]
        expect(recorded.length).toBeGreaterThanOrEqual(15)
        for (const [, hash, name, size] of recorded) {
            const bytes = fs.readFileSync(path.join(GOLDEN_DIR, name))
            expect({ name, size: bytes.length, hash: createHash('sha256').update(bytes).digest('hex').toUpperCase() })
                .toEqual({ name, size: Number(size), hash })
        }
    })
})
