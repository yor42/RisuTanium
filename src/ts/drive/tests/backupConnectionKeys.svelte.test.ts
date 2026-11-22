/**
 * Wrapped connection keys through the real `.bin` writers (`SaveLocalBackup` and `SavePartialLocalBackup`, the real
 * collector and byte store, every dialog mocked): which keys the export names before its writer opens, and what the
 * file carries. The vault is a fake over `src/ts/android/keyVault`; envelopes follow the real v1 layout in base64 and are
 * opaque to this code. A passing test here is not evidence about the Tauri or Node backends or the native Keystore.
 * Keys are synthetic.
 *
 * T21 is the regression reproducer for the missing confirm (against the S2a code a flagged key was written empty with no
 * prompt); T28 and T38 rows here are guards of the new rule.
 */
import { describe, test, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const platformBox = vi.hoisted(() => {
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: false }
})

const backupSink = vi.hoisted(() => ({ writes: [] as Uint8Array[] }))
const order = vi.hoisted(() => ({ log: [] as string[] }))
const forageKeysMock = vi.hoisted(() => vi.fn(async (): Promise<string[]> => []))
const forageGetItemMock = vi.hoisted(() => vi.fn(async (_key: string): Promise<Uint8Array | null> => null))
const forageSetItemMock = vi.hoisted(() => vi.fn(async (_key: string, _data: Uint8Array): Promise<void> => {}))
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as unknown as Database))
const alertConfirmMock = vi.hoisted(() => vi.fn(async (_message: string) => true))
const alertErrorMock = vi.hoisted(() => vi.fn())
const alertMdMock = vi.hoisted(() => vi.fn())
const alertNormalMock = vi.hoisted(() => vi.fn())

const fake = vi.hoisted(() => {
    const s = {
        unwraps: [] as string[],
        failing: new Map<string, string>(),
        failAll: null as string | null,
        failAfterOpen: false,
        failFirstOnly: new Set<string>(),
    }
    const enc = (plain: string): string => Buffer.concat([
        Buffer.from([1]), Buffer.alloc(8, 3), Buffer.alloc(12, 7), Buffer.from(plain, 'utf8'), Buffer.alloc(16, 9),
    ]).toString('base64')
    const dec = (envelope: string): string => {
        const body = Buffer.from(envelope, 'base64')
        return body.subarray(21, body.length - 16).toString('utf8')
    }
    return {
        s, enc,
        wrapKey: vi.fn(async (plain: string) => ({ ok: true as const, value: enc(plain) })),
        unwrapKey: vi.fn(async (envelope: string) => {
            s.unwraps.push(envelope)
            order.log.push('unwrap')
            if (s.failAfterOpen && order.log.includes('writer-open')) {
                return { ok: false as const, code: 'other' }
            }
            if (s.failFirstOnly.has(envelope)) {
                s.failFirstOnly.delete(envelope)
                return { ok: false as const, code: 'timeout' }
            }
            const code = s.failAll ?? s.failing.get(envelope)
            return code ? { ok: false as const, code } : { ok: true as const, value: dec(envelope) }
        }),
        watchdogFired: () => false,
    }
})

vi.mock('src/ts/android/keyVault', () => ({
    wrapKey: fake.wrapKey,
    unwrapKey: fake.unwrapKey,
    watchdogFired: fake.watchdogFired,
}))

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
    readFile: vi.fn(async () => {
        throw new Error('the Tauri backend is not under test')
    }),
    readDir: vi.fn(async () => []),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => { }),
    remove: vi.fn(async () => { }),
}))

vi.mock('@tauri-apps/plugin-process', () => ({
    relaunch: vi.fn(async () => { }),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async () => 'backup-output.bin'),
}))

vi.mock('src/ts/vendor/streamSaver', () => ({
    default: {
        useBlobFallback: false,
        createWriteStream: () => {
            order.log.push('writer-open')
            return {
                ready: Promise.resolve(),
                writable: {
                    getWriter: () => ({
                        write: async (chunk: Uint8Array) => { backupSink.writes.push(chunk.slice()) },
                        close: async () => { },
                    }),
                },
            }
        },
    },
}))

vi.mock(import('src/ts/storage/database.svelte'), async (importOriginal) => ({
    ...(await importOriginal()),
    getDatabase: getDatabaseMock,
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
    bodyIntercepterStore: writable(null),
    savingStoppedReason: writable(null),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: alertConfirmMock,
    alertError: alertErrorMock,
    alertWait: vi.fn(),
    alertMd: alertMdMock,
    alertNormal: alertNormalMock,
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(),
    alertAddCharacter: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/util'), async (importOriginal) => ({
    ...(await importOriginal()),
    changeFullscreen: vi.fn(),
    sleep: vi.fn(async () => { }),
    sleepForever: vi.fn(async () => { }),
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
    open: vi.fn(async () => { }),
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({
        listen: vi.fn(),
        setTitle: vi.fn(),
    })),
}))

vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: vi.fn(async () => new Response(null, { status: 404 })),
}))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async () => vi.fn()),
}))

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), async (importOriginal) => ({
    ...(await importOriginal()),
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    hubURL: 'https://example.invalid',
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    registerDbChangeEffects: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))

vi.mock(import('src/ts/storage/autoStorage'), () => ({
    AutoStorage: class {
        realStorage: unknown = undefined
        getItem = forageGetItemMock
        setItem = forageSetItemMock
        keys = forageKeysMock
        removeItem = vi.fn(async () => { })
    },
}) as unknown as typeof import('src/ts/storage/autoStorage'))

vi.mock(import('src/ts/gui/animation'), () => ({
    updateAnimationSpeed: vi.fn(),
}) as unknown as typeof import('src/ts/gui/animation'))

vi.mock(import('src/ts/gui/colorscheme'), async (importOriginal) => ({
    ...(await importOriginal()),
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

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

vi.mock(import('src/ts/polyfill'), () => ({
    safeStructuredClone: vi.fn((v: unknown) => structuredClone(v)),
}) as unknown as typeof import('src/ts/polyfill'))

vi.mock(import('src/ts/process/modules'), () => ({
    moduleUpdate: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/process/modules'))

class MockNotFoundError extends Error {
    name = 'NotFoundError'
}

const mockDirectoryHandle = {
    async getFileHandle(name: string) {
        throw new MockNotFoundError("not found: " + name)
    },
    async removeEntry() { },
    entries() {
        return {
            [Symbol.asyncIterator]() {
                return {
                    async next() {
                        return { done: true as const, value: undefined }
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

import { SaveLocalBackup, SavePartialLocalBackup } from 'src/ts/drive/backuplocal'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { decodeRisuSave } from 'src/ts/storage/risuSave'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createForageBackedStore } from 'src/ts/storage/tests/forageBackedStore'
import { language } from 'src/lang'
import { installVaultHost, resetVaultStoreForTest, type VaultHost, type VaultPlatform } from 'src/ts/connections/keyVaultStore.svelte'
import type { Connection } from 'src/ts/connections/connections'

//#region helpers

const decoder = new TextDecoder()

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

function writtenDatabaseEntry(): Uint8Array {
    const bytes = concat(backupSink.writes)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let offset = 0
    while (offset + 4 <= bytes.length) {
        const nameLength = view.getUint32(offset, true)
        offset += 4
        const name = decoder.decode(bytes.subarray(offset, offset + nameLength))
        offset += nameLength
        const dataLength = view.getUint32(offset, true)
        offset += 4
        if (name === 'database.risudat') {
            return bytes.slice(offset, offset + dataLength)
        }
        offset += dataLength
    }
    throw new Error('the export wrote no database entry')
}

type Tree = Record<string, unknown>
type Exported = { openAIKey?: string, claudeAPIKey?: string, proxyKey?: string, connections?: unknown } & Tree

const ENV_A = fake.enc('SYNTH-KEY-A')
const ENV_B = fake.enc('SYNTH-KEY-B')

function wrapped(id: string, name: string, provider: Connection['provider'], envelope: string): Connection {
    return { id, name, provider, key: '', keyWrapped: envelope }
}

let live: Connection[]
let platformKeeper: VaultPlatform

function installHost(platform: VaultPlatform): void {
    platformKeeper = platform
    const host: VaultHost = {
        platform,
        findConnection: (id) => live.find((conn) => conn.id === id),
        listConnections: () => live,
        requestSaveNow: () => { },
        markBootWrite: () => { },
        isReadOnlyPage: () => false,
        notify: { keepPlain: () => { }, wrapped: () => { }, reentry: () => { } },
        messages: { keyUnavailable: () => 'unavailable-text' },
    }
    installVaultHost(host)
}

/** The seed's database as a boot leaves it (a `connections` list the export reads); no `setDatabase` runs over it. */
function dbOf(seed: Tree): Database {
    return { characters: [], personas: [], characterOrder: [], botPresets: [], pluginCustomStorage: {}, ...seed } as unknown as Database
}

async function exported(): Promise<Exported> {
    return await decodeRisuSave(writtenDatabaseEntry()) as unknown as Exported
}

/** A profile whose OpenAI slot and Claude slot are the two given connections. */
function twoSlots(): Tree {
    live = [wrapped('conn-1', 'OpenAI wrapped', 'openai', ENV_A), wrapped('conn-2', 'Claude wrapped', 'anthropic', ENV_B)]
    return { connections: live, openAIKey: '', claudeAPIKey: '' }
}

//#endregion

const utf8WriterProto = Buffer.prototype as unknown as { utf8Write(this: Uint8Array, text: string, position: number, length: number): number }
const nativeUtf8Write = utf8WriterProto.utf8Write

beforeAll(() => {
    utf8WriterProto.utf8Write = function (text, position, length) {
        return nativeUtf8Write.call(this, text, position, Math.min(length, this.length - position))
    }
})

afterAll(() => { utf8WriterProto.utf8Write = nativeUtf8Write })

beforeEach(() => {
    platformBox.isTauri = false
    backupSink.writes.length = 0
    order.log.length = 0
    resetVaultStoreForTest()
    fake.s.unwraps.length = 0
    fake.s.failing.clear()
    fake.s.failAll = null
    fake.s.failAfterOpen = false
    fake.s.failFirstOnly.clear()
    alertConfirmMock.mockReset()
    alertConfirmMock.mockImplementation(async (message: string) => {
        order.log.push(`confirm:${message}`)
        return true
    })
    injectAppStore(createForageBackedStore({
        getItem: async () => null,
        setItem: async () => { },
        keys: async () => [],
        removeItem: async () => { },
    }))
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
})

function useDb(seed: Tree): void {
    getDatabaseMock.mockImplementation(() => dbOf(seed))
}

const keyConfirms = (): string[] => alertConfirmMock.mock.calls.map((call) => call[0]).filter((text) => text.includes('wrapped'))

describe('T21: the .bin names the keys it cannot carry before its writer opens', () => {
    // regression reproducer: T21
    test('T21: a connection key this device cannot read is named in one confirm before the writer opens (full export)', async () => {
        useDb(twoSlots())

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        const confirm = language.vaultExportUnreadableKeys('OpenAI wrapped, Claude wrapped')
        const at = order.log.indexOf(`confirm:${confirm}`)
        expect(at).toBeGreaterThanOrEqual(0)
        expect(at).toBeLessThan(order.log.indexOf('writer-open'))
        const out = await exported()
        expect(out.openAIKey).toBe('')
        expect(out.claudeAPIKey).toBe('')
    })

    // regression reproducer: T21
    test('T21: the same confirm comes before the writer of a partial export', async () => {
        useDb(twoSlots())

        const outcome = await SavePartialLocalBackup({}, { assetsExplained: true })

        expect(outcome.status).toBe('saved')
        const at = order.log.indexOf(`confirm:${language.vaultExportUnreadableKeys('OpenAI wrapped, Claude wrapped')}`)
        expect(at).toBeGreaterThanOrEqual(0)
        expect(at).toBeLessThan(order.log.indexOf('writer-open'))
    })

    // regression reproducer: T21
    test('T21: declining the key confirm writes nothing and ends declined', async () => {
        useDb(twoSlots())
        alertConfirmMock.mockImplementation(async (message: string) => {
            order.log.push(`confirm:${message}`)
            return !message.includes('wrapped')
        })

        const outcome = await SaveLocalBackup()

        expect(outcome).toEqual({ status: 'declined', cause: 'incomplete-data-declined' })
        expect(order.log).not.toContain('writer-open')
        expect(backupSink.writes).toHaveLength(0)
    })

    // regression reproducer: T21
    test('T21: in leave-out sheet mode the key confirm is its own dialog after the sheet, and declining it writes nothing', async () => {
        useDb({ ...twoSlots(), taskPresets: [{ name: 'TP' }] })
        const askLeaveOut = vi.fn(async () => {
            order.log.push('sheet')
            return true
        })
        alertConfirmMock.mockImplementation(async (message: string) => {
            order.log.push(`confirm:${message}`)
            return !message.includes('wrapped')
        })

        const outcome = await SaveLocalBackup({ askLeaveOut })

        expect(askLeaveOut).toHaveBeenCalledTimes(1)
        const sheetAt = order.log.indexOf('sheet')
        const keyAt = order.log.findIndex((entry) => entry.startsWith('confirm:') && entry.includes('wrapped'))
        expect(sheetAt).toBeGreaterThanOrEqual(0)
        expect(keyAt).toBeGreaterThan(sheetAt)
        expect(outcome).toEqual({ status: 'declined', cause: 'incomplete-data-declined' })
        expect(order.log).not.toContain('writer-open')
    })

    // compatibility guard (passes before and after)
    test('a profile with no wrapped key asks no key confirm', async () => {
        live = [{ id: 'conn-1', name: 'OpenAI wrapped', provider: 'openai', key: 'SYNTH-PLAIN', url: undefined }]
        useDb({ connections: live, openAIKey: '' })

        await SaveLocalBackup()

        expect(keyConfirms()).toEqual([])
        expect((await exported()).openAIKey).toBe('SYNTH-PLAIN')
    })
})

describe('T28 / T38: a wrapped key reaches the .bin from the snapshot, with no vault call once the writer is open', () => {
    const MISTRAL = (envelope: string): Connection => wrapped('conn-3', 'Mistral late', 'mistral', envelope)

    test('a readable wrapped key is exported as plain text, asks no key confirm and never carries the envelope', async () => {
        live = [wrapped('conn-1', 'OpenAI wrapped', 'openai', ENV_A)]
        installHost('vault')
        useDb({ connections: live, openAIKey: '' })

        await SaveLocalBackup()

        expect(keyConfirms()).toEqual([])
        const out = await exported()
        expect(out.openAIKey).toBe('SYNTH-KEY-A')
        expect(out.connections).toBeUndefined()
        expect(JSON.stringify(out)).not.toContain(ENV_A)
        expect(JSON.stringify(live)).toContain(ENV_A)
    })

    test('the keys are read before the fork-only and key prompts, so no wait sits between the prompts and the writer', async () => {
        live = [wrapped('conn-1', 'OpenAI wrapped', 'openai', ENV_A)]
        installHost('vault')
        useDb({ connections: live, openAIKey: '', taskPresets: [{ name: 'TP' }] })
        const askLeaveOut = vi.fn(async () => {
            order.log.push('sheet')
            return true
        })

        await SaveLocalBackup({ askLeaveOut })

        expect(order.log.indexOf('unwrap')).toBeGreaterThanOrEqual(0)
        expect(order.log.indexOf('unwrap')).toBeLessThan(order.log.indexOf('sheet'))
        expect(order.log.indexOf('sheet')).toBeLessThan(order.log.indexOf('writer-open'))
    })

    // H4: only a carrier the snapshot could not read makes a kept wait connectionKey post a vault call after the writer opens
    test('a key not readable right now is named once, exported empty, and no unwrap follows the writer open', async () => {
        live = [wrapped('conn-1', 'OpenAI wrapped', 'openai', ENV_A)]
        installHost('vault')
        fake.s.failing.set(ENV_A, 'timeout')
        useDb({ connections: live, openAIKey: '' })

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        expect(order.log).toContain(`confirm:${language.vaultExportKeysUnavailableNow('OpenAI wrapped')}`)
        expect(order.log.slice(order.log.indexOf('writer-open')).filter((entry) => entry === 'unwrap')).toEqual([])
        expect((await exported()).openAIKey).toBe('')
        expect(outcome.status === 'saved' && outcome.notices.join('\n')).not.toContain(language.vaultExportKeysLeftOutLate('OpenAI wrapped'))
    })

    test('a vault that starts failing after the confirm changes nothing: the file equals the snapshot output', async () => {
        live = [wrapped('conn-1', 'OpenAI wrapped', 'openai', ENV_A)]
        installHost('vault')
        fake.s.failAfterOpen = true
        useDb({ connections: live, openAIKey: '' })

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        expect(order.log.slice(order.log.indexOf('writer-open')).filter((entry) => entry === 'unwrap')).toEqual([])
        expect((await exported()).openAIKey).toBe('SYNTH-KEY-A')
    })

    test('a carrier first unreadable after the confirm is exported empty and named once in the export report (full and partial)', async () => {
        for (const partial of [false, true]) {
            order.log.length = 0
            backupSink.writes.length = 0
            resetVaultStoreForTest()
            live = [wrapped('conn-1', 'OpenAI wrapped', 'openai', ENV_A)]
            installHost('vault')
            fake.s.failing.set(ENV_A, 'invalidated')
            alertConfirmMock.mockImplementation(async (message: string) => {
                order.log.push(`confirm:${message}`)
                if (!live.some((item) => item.id === 'conn-3')) {
                    live.push(MISTRAL(ENV_B))
                }
                return true
            })
            useDb({ connections: live, openAIKey: '', mistralKey: '' })

            const outcome = partial ? await SavePartialLocalBackup({}, { assetsExplained: true }) : await SaveLocalBackup()

            expect(outcome.status).toBe('saved')
            expect((await exported()).mistralKey).toBe('')
            const notices = outcome.status === 'saved' ? outcome.notices.join('\n') : ''
            expect(notices, partial ? 'partial' : 'full').toContain(language.vaultExportKeysLeftOutLate('Mistral late'))
            expect(notices).not.toContain(language.vaultExportKeysLeftOutLate('OpenAI wrapped'))
            live = live.filter((item) => item.id !== 'conn-3')
        }
    })

    // H11: the .bin snapshot covers only what the translation resolves
    test('an orphaned carrier no field of the .bin would carry is neither unwrapped nor named', async () => {
        live = [
            wrapped('conn-1', 'OpenAI wrapped', 'openai', ENV_A),
            wrapped('conn-9', 'Orphan wrapped', 'openai', ENV_B),
        ]
        installHost('vault')
        fake.s.failing.set(ENV_B, 'invalidated')
        useDb({ connections: live, openAIKey: '' })

        await SaveLocalBackup()

        expect(keyConfirms()).toEqual([])
        expect(fake.s.unwraps).not.toContain(ENV_B)
        expect((await exported()).openAIKey).toBe('SYNTH-KEY-A')
    })

    test('a connection that holds a plain key and a stale envelope is exported with its plain key and not named', async () => {
        live = [{ id: 'conn-1', name: 'OpenAI wrapped', provider: 'openai', key: 'SYNTH-PLAIN', keyWrapped: ENV_A }]
        installHost('vault')
        fake.s.failing.set(ENV_A, 'invalidated')
        useDb({ connections: live, openAIKey: '' })

        await SaveLocalBackup()

        expect(keyConfirms()).toEqual([])
        expect((await exported()).openAIKey).toBe('SYNTH-PLAIN')
    })
})
