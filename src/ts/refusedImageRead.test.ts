/**
 * `readImage` and the card export portrait on an Android page, against the real `globalApi.svelte.ts`, the real
 * page store and the real `characterCards.ts`. Only the Tauri IPC boundary is replaced: the wire fake of
 * `tauriWireFake.ts` for store commands, and an access control list built from the capability files that apply on
 * Android for `plugin:fs|*` commands. A pass is not evidence about the native shell.
 *
 * - (G) an `assets...` key the native key rule refuses as outside the store makes `readImage` and the portrait
 *   export reject, and the export loads no `none.webp`; a key inside the set that holds nothing keeps the
 *   placeholder. Passes with or without the fix.
 * - (R) a path, `file:` or `content:` string sent to `readImage` is refused by the access control list on Android,
 *   so no marker bytes become the portrait. Fails while the capability files still grant `fs:allow-read-file`.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

//#region module mocks

const platform = vi.hoisted(() => ({ isTauri: true, isNodeServer: false }))
const h = vi.hoisted(() => ({
    errors: [] as string[],
    written: [] as Uint8Array[],
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
    get isTauri() { return platform.isTauri },
    get isNodeServer() { return platform.isNodeServer },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({ statics: { imports: 0 }, characters: [], goCharacterOnImport: false })),
    setDatabase: vi.fn(),
    setDatabaseLite: vi.fn(),
    importPreset: vi.fn(),
    setCurrentCharacter: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    return {
        DBState: { db: {} as unknown as Record<string, unknown> },
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
        SettingsMenuIndex: writable(-1),
        ShowRealmFrameStore: writable(''),
        settingsOpen: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn((message: string | Error) => { h.errors.push(message instanceof Error ? message.message : String(message)) }),
    alertWait: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(),
    alertAddCharacter: vi.fn(),
    alertCardExport: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => {}),
}))

vi.mock(import('src/ts/upstreamAgreement'), () => ({
    askUpstreamAgreement: vi.fn(async () => true),
    isUpstreamAccepted: vi.fn(() => true),
    publishUpstreamAccepted: vi.fn(),
}) as unknown as typeof import('src/ts/upstreamAgreement'))

vi.mock(import('src/ts/util'), () => ({
    asBuffer: (a: unknown) => a,
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    decryptBuffer: vi.fn(async (d: unknown) => d),
    isKnownUri: vi.fn(() => false),
    selectFileByDom: vi.fn(async () => null),
    sleep: vi.fn(async () => {}),
    sleepForever: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characters'), () => ({
    changeChar: vi.fn(async () => {}),
    characterFormatUpdate: vi.fn((c: unknown) => c),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: unknown) => d),
    getImageType: vi.fn(() => 'PNG'),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/parser/parser.svelte'), async (importOriginal) => ({
    ...await importOriginal(),
    hasher: vi.fn(async (data: Uint8Array) => String(data.byteLength)),
}))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    reencodeImage: vi.fn(async (d: unknown) => d),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/process/modules'), () => ({
    exportModuleLegacy: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
    readModule: vi.fn(),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({ maximize: vi.fn(async () => {}) })),
}))
vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async () => () => {}),
    emit: vi.fn(async () => {}),
}))
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn(async () => {}) }))
vi.mock('@tauri-apps/plugin-deep-link', () => ({ onOpenUrl: vi.fn(async () => vi.fn()) }))

//#endregion

import { installTauriWire, OUTSIDE_STORE_MESSAGE, type TauriWire } from 'src/ts/storage/tests/tauriWireFake'
import { getFileSrc, readImage } from 'src/ts/globalApi.svelte'
import { exportCharacterCard } from 'src/ts/characterCards'
import type { character } from 'src/ts/storage/database.svelte'

const MARKER = new TextEncoder().encode('MARKER-BYTES-OUTSIDE-THE-STORE')

type Invoke = (cmd: string, args?: unknown, options?: unknown) => Promise<unknown>
interface TauriInternals { invoke: Invoke }

/** `fs:allow-read-file` as the permission names it, to the command it grants. */
function commandOf(permission: string): string | null {
    const match = /^fs:allow-(.+)$/.exec(permission)
    return match === null ? null : match[1].replace(/-/g, '_')
}

/** The `plugin:fs|*` commands the capability files that apply on Android grant: no `platforms` list, or one naming android. */
function androidGrantedFsCommands(): Set<string> {
    const directory = resolve(__dirname, '../../src-tauri/capabilities')
    const granted = new Set<string>()
    for (const name of readdirSync(directory).filter((file) => file.endsWith('.json'))) {
        const capability = JSON.parse(readFileSync(resolve(directory, name), 'utf8')) as { platforms?: string[], permissions: (string | { identifier: string })[] }
        if (capability.platforms !== undefined && !capability.platforms.includes('android')) {
            continue
        }
        for (const entry of capability.permissions) {
            const command = commandOf(typeof entry === 'string' ? entry : entry.identifier)
            if (command !== null) {
                granted.add(command)
            }
        }
    }
    return granted
}

type AclWording = 'release' | 'debug'

function aclRefusal(wording: AclWording, command: string): string {
    return wording === 'release'
        ? `Command plugin:fs|${command} not allowed by ACL`
        : `fs.${command} not allowed. Permissions associated with this command: fs:allow-${command.replace(/_/g, '-')}`
}

let wire: TauriWire
let fetched: string[]

/**
 * Puts the Android access control list in front of the wire fake: a `plugin:fs|*` command the capability files do not
 * grant is refused with the plugin's string before any I/O, and a granted `read_file` answers the marker bytes.
 */
function installAcl(wording: AclWording): void {
    const target = window as unknown as { __TAURI_INTERNALS__: TauriInternals }
    const inner = target.__TAURI_INTERNALS__.invoke
    const granted = androidGrantedFsCommands()
    target.__TAURI_INTERNALS__.invoke = async (cmd, args, options) => {
        if (cmd.startsWith('plugin:fs|')) {
            const command = cmd.slice('plugin:fs|'.length)
            if (!granted.has(command)) {
                throw aclRefusal(wording, command)
            }
            if (command === 'read_file') {
                return MARKER.slice().buffer
            }
        }
        return await inner(cmd, args, options)
    }
}

function syntheticCharacter(image: string): character {
    return { name: 'Synthetic', image, globalLore: [], desc: 'd', firstMessage: 'hi', ccAssets: [] } as unknown as character
}

function recordingWriter() {
    return {
        init: async () => true,
        write: async (data: Uint8Array) => { h.written.push(data.slice()) },
        close: async () => {},
        abort: () => {},
    }
}

const realFetch = globalThis.fetch

beforeEach(() => {
    wire = installTauriWire({ os: 'android' })
    h.errors.length = 0
    h.written.length = 0
    fetched = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        fetched.push(String(input))
        return new Response(new Uint8Array([1, 2, 3]).buffer as ArrayBuffer, { status: 200 })
    }) as unknown as typeof fetch
})

afterEach(() => {
    globalThis.fetch = realFetch
    wire.uninstall()
})

function containsMarker(parts: Uint8Array[]): boolean {
    const text = Buffer.concat(parts.map((part) => Buffer.from(part))).toString('latin1')
    return text.includes('MARKER-BYTES-OUTSIDE-THE-STORE')
}

describe('an assets key outside the native store (G)', () => {
    const OUTSIDE_KEY = 'assetsX/portrait.png'

    test('readImage rejects with the key refusal', async () => {
        await expect(readImage(OUTSIDE_KEY)).rejects.toBe(OUTSIDE_STORE_MESSAGE)
    })

    test('the portrait export rejects, loads no none.webp and writes nothing', async () => {
        await expect(exportCharacterCard(syntheticCharacter(OUTSIDE_KEY), 'png', { spec: 'v3', writer: recordingWriter() as never })).rejects.toBe(OUTSIDE_STORE_MESSAGE)
        expect(fetched).toEqual([])
        expect(h.written).toEqual([])
    })

    test('a key inside the set that holds nothing keeps the placeholder', async () => {
        await exportCharacterCard(syntheticCharacter('assets/0123456789abcdef0123456789abcdef.png'), 'png', { spec: 'v3', writer: recordingWriter() as never })
        expect(fetched).toEqual(['/none.webp'])
    })
})

describe.each<AclWording>(['release', 'debug'])('a path string on an Android page with the access control list (%s wording) (R)', (wording) => {
    const STRINGS = [
        '/data/user/0/io.github.yor42.risutanium/shared_prefs/secrets.xml',
        '/data/data/io.github.yor42.risutanium/databases/main.db',
        'file:///data/user/0/io.github.yor42.risutanium/shared_prefs/secrets.xml',
        'content://com.example.documents/document/marker',
    ]

    beforeEach(() => {
        installAcl(wording)
    })

    test.each(STRINGS)('readImage(%s) does not return the marker bytes', async (text) => {
        const outcome = await readImage(text).then((bytes) => ({ bytes }), (error: unknown) => ({ error }))
        expect(outcome, `readImage resolved with ${JSON.stringify('bytes' in outcome ? Array.from(outcome.bytes).length : 0)} bytes`).toHaveProperty('error', aclRefusal(wording, 'read_file'))
    })

    test.each(STRINGS)('the portrait export of %s rejects and the marker never becomes the portrait', async (text) => {
        const outcome = await exportCharacterCard(syntheticCharacter(text), 'png', { spec: 'v3', writer: recordingWriter() as never }).then(() => 'resolved', (error: unknown) => error)
        expect(containsMarker(h.written), 'the marker bytes were written as the portrait').toBe(false)
        expect(outcome).toBe(aclRefusal(wording, 'read_file'))
        expect(fetched).toEqual([])
    })
})

describe.each<AclWording>(['release', 'debug'])('a display through getFileSrc on an Android page (%s wording) (G)', (wording) => {
    beforeEach(() => {
        installAcl(wording)
    })

    test('a path outside the store becomes a protocol URL without any file read or message', async () => {
        const url = await getFileSrc('/data/user/0/io.github.yor42.risutanium/shared_prefs/secrets.xml')
        expect(typeof url).toBe('string')
        expect(wire.calls.filter((call) => call.cmd.startsWith('plugin:fs|read'))).toEqual([])
        expect(h.errors).toEqual([])
    })

    test('an assets key outside the store is blank and shows no message', async () => {
        expect(await getFileSrc('assetsX/portrait.png')).toBe('')
        expect(h.errors).toEqual([])
    })

    test('a key inside the asset scope still reaches the store', async () => {
        const url = await getFileSrc('assets/0123456789abcdef0123456789abcdef.png')
        expect(typeof url).toBe('string')
        expect(h.errors).toEqual([])
    })
})
describe.each<AclWording>(['release', 'debug'])('the plugin readImage shape on an Android page (%s wording) (G)', (wording) => {
    test('a plugin path is always prefixed with assets, so it goes to the store and never to a plugin:fs read', async () => {
        installAcl(wording)
        const outcome = await readImage('assets/' + '/data/user/0/io.github.yor42.risutanium/shared_prefs/secrets.xml').then(() => 'resolved', (error: unknown) => error)
        expect(outcome).not.toBe('resolved')
        expect(wire.calls.filter((call) => call.cmd.startsWith('plugin:fs|'))).toEqual([])
    })
})