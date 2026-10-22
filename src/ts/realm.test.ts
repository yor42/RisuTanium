/**
 * `shareRealmCardData` in `src/ts/realm.ts` hands the Realm frame a complete card, or `null` with the export's own
 * error left on screen.
 *
 * The real `realm.ts`, `characterCards.ts`, `pngChunk.ts` and the real `VirtualWriter` run against a synthetic
 * character. The writer is wrapped so a write can be made to fail, which is how a failure inside the export `try`
 * reaches the caller in production. MOCKED: alerts, the database, the image store and every other import of
 * `characterCards.ts`. Titles beginning "guard:" pass before and after the change; titles beginning "regression
 * reproducer:" fail against a version that returns the partial buffer and clears the alert store after a failed export.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

const h = vi.hoisted(() => ({
    errors: [] as string[],
    alerts: [] as Array<{ type: string, msg: string }>,
    png: new Uint8Array() as Uint8Array,
    failWrite: false,
}))

vi.mock('uuid', () => ({
    v4: () => 'uuid-1',
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
    return {
        alertCardExport: vi.fn(),
        alertConfirm: vi.fn(async () => true),
        alertError: vi.fn((msg: string | Error) => {
            h.errors.push(text(msg))
            h.alerts.push({ type: 'error', msg: text(msg) })
        }),
        alertInput: vi.fn(async () => ''),
        alertMd: vi.fn(),
        alertNormal: vi.fn(),
        alertNormalWait: vi.fn(async () => { }),
        alertStore: {
            set: vi.fn((value: { type: string, msg: string }) => { h.alerts.push({ type: value.type, msg: value.msg }) }),
            subscribe: vi.fn(),
            update: vi.fn(),
        },
        alertWait: vi.fn(),
    } as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    defaultSdDataFunc: vi.fn(() => ({})),
    setDatabase: vi.fn(),
    importPreset: vi.fn(),
    setCurrentCharacter: vi.fn(),
    getCurrentCharacter: vi.fn(() => ({
        name: 'Synthetic',
        image: 'synthetic-image',
        globalLore: [],
        desc: 'd',
        firstMessage: 'hi',
        ccAssets: [],
    })),
    getDatabase: vi.fn(() => ({ statics: { imports: 0 }, characters: [], goCharacterOnImport: false })),
    setDatabaseLite: vi.fn(),
    appVer: 'test',
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/util'), () => ({
    asBuffer: (a: unknown) => a,
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    decryptBuffer: vi.fn(async (d: unknown) => d),
    isKnownUri: vi.fn(() => false),
    selectFileByDom: vi.fn(async () => null),
    sleep: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characters'), () => ({
    changeChar: vi.fn(async () => { }),
    characterFormatUpdate: vi.fn((c: unknown) => c),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const { AppendableBuffer, VirtualWriter: RealVirtualWriter } = await import('src/ts/byteBuffer')
    class VirtualWriter extends RealVirtualWriter {
        write(data: Uint8Array): void {
            if (h.failWrite) {
                throw new Error('synthetic write failure')
            }
            super.write(data)
        }
    }
    return {
        AppendableBuffer,
        BlankWriter: class { },
        LocalWriter: class { },
        VirtualWriter,
        checkCharOrder: vi.fn(),
        downloadFile: vi.fn(async () => { }),
        loadAsset: vi.fn(async () => new Uint8Array()),
        openURL: vi.fn(),
        readImage: vi.fn(async () => h.png),
        saveAsset: vi.fn(async () => 'saved'),
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: unknown) => d),
    getImageType: vi.fn(() => 'PNG'),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return { characters: [] } } },
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
    exportModuleLegacy: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
    readModule: vi.fn(),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    readFile: vi.fn(async () => new Uint8Array()),
    writeFile: vi.fn(async () => { }),
}))

vi.mock('@tauri-apps/plugin-deep-link', () => ({
    onOpenUrl: vi.fn(async () => vi.fn()),
}))

//#endregion

import { shareRealmCardData } from 'src/ts/realm'

function syntheticPng(): Uint8Array {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    const ihdr = [0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0x90, 0x77, 0x53, 0xde]
    const iend = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]
    return new Uint8Array([...signature, ...ihdr, ...iend])
}

beforeEach(() => {
    globalThis.safeStructuredClone = structuredClone
    h.errors.length = 0
    h.alerts.length = 0
    h.failWrite = false
    h.png = syntheticPng()
})

describe('shareRealmCardData', () => {
    test('guard: a completed export returns the card bytes and clears the progress alert', async () => {
        const shared = await shareRealmCardData()
        expect(shared).not.toBeNull()
        expect(new TextDecoder().decode(shared!.name)).toBe('Synthetic.png')
        expect(shared!.data.byteLength).toBeGreaterThan(h.png.byteLength)
        expect(h.errors).toEqual([])
        expect(h.alerts[h.alerts.length - 1]).toEqual({ type: 'none', msg: '' })
    })

    test('regression reproducer: a write failure inside the export returns null and leaves the error alert', async () => {
        h.failWrite = true
        const shared = await shareRealmCardData()
        expect(shared).toBeNull()
        expect(h.errors).toEqual(['synthetic write failure'])
        expect(h.alerts[h.alerts.length - 1]).toEqual({ type: 'error', msg: 'synthetic write failure' })
        expect(h.alerts.some((alert) => alert.type === 'none')).toBe(false)
    })
})
