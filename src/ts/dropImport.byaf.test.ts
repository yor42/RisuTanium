/**
 * A `.byaf` file dropped on the app goes through `importDroppedFile` in `src/ts/dropImport.ts` into the real
 * `characterCards.ts` card import. The existing drop tests replace `characterCards` with a recorder and can only show
 * that the call arrives; this file runs the real import behind it.
 *
 * Reproducer: on the base commit a dropped `.byaf` reaches the png refusal, so no character is added and the
 * `characters.length` assertion fails. The real `characterCards.ts`, `processzip.ts`, `dropImport.ts` and fflate run
 * against a synthetic archive; the database, asset storage and alerts are recorders.
 */

import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as fflate from 'fflate'

const h = vi.hoisted(() => ({
    saveCalls: 0,
    characters: [] as Array<Record<string, unknown>>,
    errors: [] as string[],
    ordered: 0,
    uuid: 0,
}))

vi.mock('uuid', () => ({ v4: () => `uuid-${++h.uuid}` }))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: false }) as unknown as typeof import('src/ts/platform'))
vi.mock(import('src/ts/upstreamAgreement'), () => ({
    askUpstreamAgreement: vi.fn(async () => true),
    isUpstreamAccepted: vi.fn(() => true),
    publishUpstreamAccepted: vi.fn(),
}) as unknown as typeof import('src/ts/upstreamAgreement'))
vi.mock(import('src/ts/alert'), () => ({
    alertCardExport: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn((m: unknown) => { h.errors.push(m instanceof Error ? m.message : String(m)) }),
    alertInput: vi.fn(async () => ''),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertWait: vi.fn(),
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    defaultSdDataFunc: vi.fn(() => ({})),
    setDatabase: vi.fn(),
    importPreset: vi.fn(),
    setCurrentCharacter: vi.fn(),
    getCurrentCharacter: vi.fn(),
    setDatabaseLite: vi.fn(),
    appVer: 'test',
    getDatabase: vi.fn(() => ({ statics: { imports: 0 }, characters: h.characters, goCharacterOnImport: false })),
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
        decryptBuffer: vi.fn(async (d: unknown) => d),
        isKnownUri: vi.fn(() => false),
        selectFileByDom: vi.fn(async () => null),
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
        checkCharOrder: vi.fn(() => { h.ordered++ }),
        downloadFile: vi.fn(async () => {}),
        forageStorage: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
        loadAsset: vi.fn(async () => new Uint8Array()),
        openURL: vi.fn(),
        readImage: vi.fn(async (d: unknown) => d),
        pieceStoreOrNull: vi.fn(async () => null),
        saveAssetFromPieces: vi.fn(async () => { throw new Error('not used') }),
        saveAsset: vi.fn(async (data: Uint8Array) => { h.saveCalls++; return createHash('sha1').update(data).digest('hex') }),
    } as unknown as typeof import('src/ts/globalApi.svelte')
})
vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: unknown) => d),
    getImageType: vi.fn(() => 'png'),
}) as unknown as typeof import('src/ts/media'))
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return { characters: h.characters, modules: [] } } },
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
vi.mock(import('src/ts/process/modules'), () => ({
    exportModuleLegacy: vi.fn(),
    readModule: vi.fn(async () => ({ lorebook: [], trigger: [], regex: [] })),
}) as unknown as typeof import('src/ts/process/modules'))
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: vi.fn(async () => new Uint8Array()), open: vi.fn() }))
vi.mock('@tauri-apps/plugin-deep-link', () => ({ onOpenUrl: vi.fn(async () => vi.fn()) }))

import { importDroppedFile } from 'src/ts/dropImport'

const enc = new TextEncoder()
const AVATAR = (() => {
    const a = new Uint8Array(1000)
    let x = 1
    for (let i = 0; i < a.length; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; a[i] = (x >> 16) & 0xff }
    a.set([0x89, 0x50, 0x4e, 0x47], 0)
    return a
})()

function archive(): Uint8Array {
    const manifest = { schemaVersion: 1, characters: ['characters/c1/character.json'], scenarios: ['scenarios/s1.json'] }
    const character = { schemaVersion: 1, id: 'c1', name: 'Ann', images: [{ path: 'images/avatar.png', label: 'avatar' }] }
    const scenario = { schemaVersion: 1, narrative: 'n', firstMessages: [{ text: 'Hello' }] }
    return fflate.zipSync({
        'manifest.json': [enc.encode(JSON.stringify(manifest)), { level: 0 }],
        'characters/c1/images/avatar.png': [AVATAR, { level: 0 }],
        'characters/c1/character.json': [enc.encode(JSON.stringify(character)), { level: 0 }],
        'scenarios/s1.json': [enc.encode(JSON.stringify(scenario)), { level: 0 }],
    })
}

beforeEach(() => {
    h.saveCalls = 0
    h.characters = []
    h.errors = []
    h.ordered = 0
    h.uuid = 0
    // The production safeStructuredClone returns undefined for undefined; the setup stub is a JSON round trip.
    globalThis.safeStructuredClone = structuredClone
})

describe('a dropped .byaf file', () => {
    test.each(['Card.BYAF', 'card.byaf'])('R16 reproducer: %s imports one character through the real drop and card import', async (name) => {
        await importDroppedFile(new File([new Uint8Array(archive())], name))
        expect(h.characters.length).toBe(1)
        expect(h.characters[0]).toMatchObject({ name: 'Ann', firstMessage: 'Hello' })
        expect(h.saveCalls).toBe(1)
        expect(h.ordered).toBe(1)
        expect(h.errors).toEqual([])
    })
})
