/**
 * The charx path of `importCharacterProcess` in `src/ts/characterCards.ts` when the import ends without a character
 * after the archive was parsed: nothing about the import may change the alert after it has ended.
 *
 * The real `characterCards.ts`, `processzip.ts`, `modules.ts` (so a real `readModule` judges the embedded module) and
 * fflate run on synthetic archives. Asset storage is gated on promises the test releases, so asset saves are still in
 * flight when the import ends; an instant save would finish every progress alert during parsing and hide the defect.
 * The alert functions all write one slot, like the real store, and the confirm prompt shows an 'ask' value and, when
 * declined, leaves the slot at 'none' as the real prompt does, so the test reads what the user would be left looking at.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as fflate from 'fflate'

//#region module mocks

const h = vi.hoisted(() => ({
    /** what the single alert slot holds: every alert function replaces it */
    last: 'none' as string,
    /** every write to the alert slot, in order */
    log: [] as string[],
    errors: [] as string[],
    characters: [] as Array<Record<string, unknown>>,
    saveCalls: 0,
    saved: [] as string[],
    /** when true every saveAsset waits for a gate the test releases */
    gated: false,
    gates: [] as Array<{ resolve: () => void, reject: (e: Error) => void }>,
    confirm: true,
    uuid: 0,
}))

vi.mock('uuid', () => ({
    v4: () => `uuid-${++h.uuid}`,
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/upstreamAgreement'), () => ({
    askUpstreamAgreement: vi.fn(async () => true),
    isUpstreamAccepted: vi.fn(() => true),
    publishUpstreamAccepted: vi.fn(),
}) as unknown as typeof import('src/ts/upstreamAgreement'))

vi.mock(import('src/ts/alert'), () => {
    const text = (msg: string | Error) => msg instanceof Error ? msg.message : String(msg)
    const write = (slot: string) => { h.last = slot; h.log.push(slot) }
    return {
        alertCardExport: vi.fn(),
        alertClear: vi.fn(() => write('none')),
        alertConfirm: vi.fn(async () => {
            write('ask')
            if (!h.confirm) write('none')
            return h.confirm
        }),
        alertError: vi.fn((msg: string | Error) => { h.errors.push(text(msg)); write('error:' + text(msg)) }),
        alertInput: vi.fn(async () => ''),
        alertMd: vi.fn(),
        alertModuleSelect: vi.fn(),
        alertNormal: vi.fn((msg: string) => write('normal:' + msg)),
        alertStore: {
            set: (v: { type?: string, msg?: string }) => write(v.type === 'none' ? 'none' : `${v.type}:${v.msg}`),
            subscribe: vi.fn(),
            update: vi.fn(),
        },
        alertWait: vi.fn((msg: string) => write('wait:' + msg)),
    } as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    defaultSdDataFunc: vi.fn(() => ({})),
    setDatabase: vi.fn(),
    importPreset: vi.fn(),
    setCurrentCharacter: vi.fn(),
    getCurrentCharacter: vi.fn(),
    getCurrentChat: vi.fn(),
    getDatabase: vi.fn(() => ({ statics: { imports: 0 }, characters: h.characters, modules: [], goCharacterOnImport: false })),
    setDatabaseLite: vi.fn(),
    appVer: 'test',
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/util'), () => {
    class Semaphore {
        private available: number
        private readonly max: number
        private waiting: Array<() => void> = []
        constructor(max: number) { this.available = max; this.max = max }
        async acquire(): Promise<void> {
            if (this.available > 0) { this.available -= 1; return }
            await new Promise<void>((resolve) => this.waiting.push(resolve))
        }
        release(): void {
            const next = this.waiting.shift()
            if (next) { next(); return }
            if (this.available < this.max) this.available += 1
        }
    }
    return {
        asBuffer: (a: unknown) => a,
        Semaphore,
        checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
        checkPersonaBinded: vi.fn(),
        decryptBuffer: vi.fn(async (d: unknown) => d),
        isKnownUri: vi.fn(() => false),
        selectFileByDom: vi.fn(async () => null),
        selectSingleFile: vi.fn(async () => null),
        sleep: vi.fn(async () => {}),
    } as unknown as typeof import('src/ts/util')
})

vi.mock(import('src/ts/characters'), () => ({
    changeChar: vi.fn(async () => {}),
    characterFormatUpdate: vi.fn((c: unknown) => c),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const { AppendableBuffer } = await import('src/ts/byteBuffer')
    return {
        AppendableBuffer,
        BlankWriter: class {},
        LocalWriter: class {},
        VirtualWriter: class {},
        checkCharOrder: vi.fn(),
        downloadFile: vi.fn(async () => {}),
        forageStorage: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
        loadAsset: vi.fn(async () => new Uint8Array()),
        openURL: vi.fn(),
        readImage: vi.fn(async (d: unknown) => d),
        saveAsset: vi.fn(async (data: Uint8Array) => {
            h.saveCalls++
            if (h.gated) {
                await new Promise<void>((resolve, reject) => h.gates.push({ resolve, reject }))
            }
            const id = `asset-${data[0]}-${data.length}`
            h.saved.push(id)
            return id
        }),
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: unknown) => d),
    getImageType: vi.fn(() => 'png'),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return { characters: h.characters, modules: [] } } },
    HideIconStore: { set: vi.fn() },
    moduleBackgroundEmbedding: { set: vi.fn() },
    ReloadGUIPointer: { set: vi.fn() },
    SettingsMenuIndex: { set: vi.fn() },
    ShowRealmFrameStore: { set: vi.fn() },
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
    selectedCharID: { set: vi.fn() },
    settingsOpen: { set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    reencodeImage: vi.fn(async (d: unknown) => d),
}) as unknown as typeof import('src/ts/process/files/inlays'))

// The RPack layer is the identity here, so a synthetic module is plain JSON.
vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    decodeRPack: vi.fn(async (d: Uint8Array) => d),
    encodeRPack: vi.fn(async (d: Uint8Array) => d),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    convertExternalLorebook: vi.fn(),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

vi.mock(import('src/ts/interchangeability'), () => ({
    convertCharacterToModule: vi.fn(),
    convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    readFile: vi.fn(async () => new Uint8Array()),
}))

vi.mock('@tauri-apps/plugin-deep-link', () => ({
    onOpenUrl: vi.fn(async () => vi.fn()),
}))

//#endregion

import { importCharacterProcess } from 'src/ts/characterCards'
import { language } from 'src/lang'

// ---------------------------------------------------------------------------------------------
// Synthetic archives (no real images, no user data)
// ---------------------------------------------------------------------------------------------

const enc = new TextEncoder()
const ASSET_COUNT = 12
const assetNames = Array.from({ length: ASSET_COUNT }, (_, i) => `assets/a${i}.bin`)

const cardJson = (over: { spec?: string, lowLevelAccess?: boolean, assets?: string[] } = {}) => JSON.stringify({
    spec: over.spec ?? 'chara_card_v3',
    spec_version: '3.0',
    data: {
        name: 'Synthetic', description: 'd', first_mes: 'hi', character_version: '1',
        extensions: { risuai: over.lowLevelAccess ? { lowLevelAccess: true } : {} },
        assets: (over.assets ?? assetNames).map((n) => ({ type: 'x-risu-asset', uri: 'embeded://' + n, name: n, ext: 'bin' })),
    },
})

/** magic, version, length-prefixed main block, end mark; the RPack layer is the identity here */
function risum(over: { magic?: number, lorebook?: unknown[] } = {}): Uint8Array {
    const main = Buffer.from(JSON.stringify({
        type: 'risuModule',
        module: { name: 'Embedded', description: 'd', id: 'x', lorebook: over.lorebook, trigger: [], regex: [] },
    }))
    const len = Buffer.alloc(4)
    len.writeUInt32LE(main.length, 0)
    return new Uint8Array(Buffer.concat([Buffer.from([over.magic ?? 111, 0]), len, main, Buffer.from([0])]))
}

function archive(opts: { card?: string | null, module?: Uint8Array, assets?: boolean } = {}): File {
    const files: fflate.Zippable = {}
    if (opts.card !== null) files['card.json'] = [enc.encode(opts.card ?? cardJson()), { level: 0 }]
    if (opts.module) files['module.risum'] = [opts.module, { level: 0 }]
    if (opts.assets !== false) {
        assetNames.forEach((n, i) => { files[n] = [new Uint8Array(64).fill(i + 1), { level: 0 }] })
    }
    return new File([new Uint8Array(fflate.zipSync(files))], 'card.charx', { type: 'application/zip' })
}

const tick = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Releases every save that is waiting, and every save that starts as a result, until none is left. */
async function drain(fail?: Error) {
    for (let i = 0; i < 20; i++) {
        const waiting = h.gates.splice(0)
        waiting.forEach((g) => fail ? g.reject(fail) : g.resolve())
        await tick(5)
        if (waiting.length === 0) return
    }
}

async function runImport(file: File): Promise<{ returned: unknown, thrown: string | null }> {
    let returned: unknown
    let thrown: string | null = null
    try {
        returned = await importCharacterProcess({ name: file.name, data: file })
    } catch (e) {
        thrown = e instanceof Error ? e.message : String(e)
    }
    return { returned, thrown }
}

beforeEach(() => {
    h.last = 'none'
    h.log = []
    h.errors = []
    h.characters = []
    h.saveCalls = 0
    h.saved = []
    h.gated = false
    h.gates = []
    h.confirm = true
    h.uuid = 0
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------------------------
// An import that ends without a character leaves the alert as the exit set it
// ---------------------------------------------------------------------------------------------

describe('a charx import that ends without a character while asset saves are in flight', () => {
    test.each([
        ['has no card.json', () => archive({ card: null }), language.errors.noData],
        ['is not a v3 card', () => archive({ card: cardJson({ spec: 'chara_card_v2' }) }), language.errors.noData],
    ])('an archive that %s keeps its error as the last message after the saves finish', async (_label, make, message) => {
        h.gated = true
        const out = await runImport(make())
        expect(out.thrown).toBeNull()
        expect(out.returned).toBeUndefined()
        expect(h.last).toBe('error:' + message)
        expect(h.errors).toEqual([message])
        const shown = [...h.log]
        await drain()
        expect(h.last).toBe('error:' + message)
        expect(h.log).toEqual(shown)
        expect(h.characters).toEqual([])
    })

    test('an embedded module with a wrong magic byte refuses the card with one error, no character, and keeps the error last', async () => {
        h.gated = true
        const out = await runImport(archive({ module: risum({ magic: 0 }) }))
        expect(out.thrown).toBeNull()
        expect(out.returned).toBeUndefined()
        expect(h.errors).toEqual([language.errors.noData])
        expect(h.last).toBe('error:' + language.errors.noData)
        const shown = [...h.log]
        await drain()
        expect(h.last).toBe('error:' + language.errors.noData)
        expect(h.log).toEqual(shown)
        expect(h.characters).toEqual([])
    })

    test('a declined low-level-access prompt shows no error, leaves the alert cleared and adds no character (compatibility guard)', async () => {
        h.confirm = false
        const out = await runImport(archive({ card: cardJson({ lowLevelAccess: true }) }))
        expect(out.thrown).toBeNull()
        expect(h.errors).toEqual([])
        expect(h.last).toBe('none')
        expect(h.characters).toEqual([])
    })

    test('an import that throws after parsing sets no progress message after the throw', async () => {
        h.gated = true
        const out = await runImport(archive({ card: '{ this is not json' }))
        expect(out.thrown).not.toBeNull()
        const shown = [...h.log]
        await drain()
        expect(h.log).toEqual(shown)
        expect(h.characters).toEqual([])
    })

    test('saves that had not started when the import ended never start', async () => {
        h.gated = true
        await runImport(archive({ card: null }))
        const started = h.saveCalls
        expect(started).toBeGreaterThan(0)
        expect(started).toBeLessThan(ASSET_COUNT)
        await drain()
        expect(h.saveCalls).toBe(started)
    })

    test('the error is shown without waiting for in-flight saves (compatibility guard)', async () => {
        h.gated = true
        const settled = await Promise.race([
            runImport(archive({ card: null })).then(() => 'returned'),
            tick(1000).then(() => 'waited'),
        ])
        expect(settled).toBe('returned')
        expect(h.last).toBe('error:' + language.errors.noData)
        await drain()
    })

    test('saves that fail after the import ended produce no unhandled rejection', async () => {
        const unhandled: unknown[] = []
        const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
        process.on('unhandledRejection', onUnhandled)
        try {
            h.gated = true
            await runImport(archive({ card: null }))
            await drain(new Error('storage full'))
            await tick(20)
            expect(unhandled).toEqual([])
            expect(h.last).toBe('error:' + language.errors.noData)
        } finally {
            process.off('unhandledRejection', onUnhandled)
        }
    })
})

// ---------------------------------------------------------------------------------------------
// Compatibility guards: a complete archive still saves every asset and imports
// ---------------------------------------------------------------------------------------------

describe('a complete charx import (compatibility guard)', () => {
    test('saves every asset, imports one character and ends on the success message', async () => {
        const out = await runImport(archive())
        expect(out.thrown).toBeNull()
        expect(h.saveCalls).toBe(ASSET_COUNT)
        expect(new Set(h.saved).size).toBe(ASSET_COUNT)
        expect(h.characters).toHaveLength(1)
        expect(h.errors).toEqual([])
        expect(h.last).toBe('normal:' + language.importedCharacter)
    })

    test('saves every asset when the saves finish after parsing ended', async () => {
        h.gated = true
        const pending = runImport(archive())
        await tick(50)
        await drain()
        const out = await pending
        expect(out.thrown).toBeNull()
        expect(h.saved).toHaveLength(ASSET_COUNT)
        expect(h.characters).toHaveLength(1)
        expect(h.last).toBe('normal:' + language.importedCharacter)
    })

    test('a valid embedded module is read by the real readModule and its lorebook reaches the character', async () => {
        const lorebook = [{ key: 'k', comment: 'lore', content: 'c', mode: 'normal', insertorder: 1, alwaysActive: false, selective: false, secondkey: '' }]
        const out = await runImport(archive({ module: risum({ lorebook }) }))
        expect(out.thrown).toBeNull()
        expect(h.errors).toEqual([])
        expect(h.characters).toHaveLength(1)
        expect(h.characters[0].globalLore).toEqual(lorebook)
        expect(h.saveCalls).toBe(ASSET_COUNT)
    })
})
