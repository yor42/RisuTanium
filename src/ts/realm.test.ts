/**
 * `shareRealmCardData` in `src/ts/realm.ts` hands the Realm frame a complete card, or `null` after a failure: the
 * export's fail card stays up, and a failure before the card opens posts the error notice.
 *
 * The real `realm.ts`, `characterCards.ts`, `pngChunk.ts` and the real `VirtualWriter` run against a synthetic
 * character. The writer is wrapped so a write can be made to fail, which is how a failure inside the export `try`
 * reaches the caller in production. MOCKED: alerts, the database, the image store and every other import of
 * `characterCards.ts`. The real `exportTask` and `alertTask` run, so the card is read through `taskHostView`. Titles
 * containing "guard" pass before and after the change; titles containing "regression reproducer" fail against a version
 * that runs on the legacy alert progress, clears the alert store and lets a rejection escape.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

const h = vi.hoisted(() => ({
    errors: [] as string[],
    alerts: [] as Array<{ type: string, msg: string }>,
    png: new Uint8Array() as Uint8Array,
    failWrite: false,
    failImage: false,
    refuse: false,
    refusals: [] as string[],
    refusalCards: [] as unknown[],
    cards: [] as unknown[],
}))

vi.mock('uuid', () => ({
    v4: () => 'uuid-1',
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/drive/exportPreflight'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        preflightExport: async (...args: Parameters<typeof actual.preflightExport>) =>
            h.refuse ? { kind: 'refuse-large', names: ['Big Video'] } as const : actual.preflightExport(...args),
        refuseExport: async (...args: Parameters<typeof actual.refuseExport>) => {
            h.refusals.push(args[0].kind)
            h.refusalCards.push(taskHostView())
            return actual.refuseExport(...args)
        },
    }
})

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
            h.cards.push(taskHostView())
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
        readImage: vi.fn(async () => {
            if (h.failImage) {
                throw new Error('synthetic image failure')
            }
            return h.png
        }),
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
import { resetTaskHostForTests, taskHostView } from 'src/ts/alertTask.svelte'

function syntheticPng(): Uint8Array {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    const ihdr = [0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0x90, 0x77, 0x53, 0xde]
    const iend = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]
    return new Uint8Array([...signature, ...ihdr, ...iend])
}

beforeEach(() => {
    resetTaskHostForTests()
    globalThis.safeStructuredClone = structuredClone
    h.errors.length = 0
    h.alerts.length = 0
    h.refusals.length = 0
    h.refusalCards.length = 0
    h.cards.length = 0
    h.failWrite = false
    h.failImage = false
    h.refuse = false
    h.png = syntheticPng()
    vi.spyOn(console, 'error').mockImplementation(() => { })
    return () => {
        resetTaskHostForTests()
        vi.restoreAllMocks()
    }
})

describe('shareRealmCardData', () => {
    test('RL1 regression reproducer: a completed export returns the card bytes, shows a card without Cancel while it runs and leaves none', async () => {
        const shared = await shareRealmCardData()
        expect(shared).not.toBeNull()
        expect(new TextDecoder().decode(shared!.name)).toBe('Synthetic.png')
        expect(shared!.data.byteLength).toBeGreaterThan(h.png.byteLength)
        expect(h.errors).toEqual([])
        expect(h.cards.length).toBeGreaterThan(0)
        for (const card of h.cards as Array<ReturnType<typeof taskHostView>>) {
            expect(card?.title).toBe('Preparing the Realm upload')
            expect(card?.subtitle).toBe('Synthetic')
            expect(card?.cancelOffered).toBe(false)
        }
        expect(taskHostView()).toBeNull()
        expect(h.alerts.filter((alert) => ['progress', 'wait', 'none'].includes(alert.type))).toEqual([])
    })

    test('RL2 regression reproducer: a write failure inside the export returns null and ends as a fail card, not an alert', async () => {
        h.failWrite = true
        const shared = await shareRealmCardData()
        expect(shared).toBeNull()
        expect(h.errors).toEqual([])
        expect(taskHostView()?.state).toBe('failed')
        expect(taskHostView()?.failure?.detail).toBe('synthetic write failure')
    })

    test('RL3 regression reproducer: an image that cannot be read resolves null with a fail card, not a rejection', async () => {
        h.failImage = true
        const outcome = await shareRealmCardData().then(() => 'resolved', () => 'rejected')
        expect(outcome).toBe('resolved')
        expect(taskHostView()?.state).toBe('failed')
        expect(taskHostView()?.failure?.detail).toBe('synthetic image failure')
        expect(h.errors).toEqual([])
    })

    test('RL4 regression reproducer: a preflight that throws resolves null with the error notice and no card', async () => {
        globalThis.safeStructuredClone = (v) => {
            const copy = structuredClone(v) as object
            Object.defineProperty(copy, 'globalLore', { get() { throw new Error('synthetic preflight failure') }, enumerable: true })
            return copy as typeof v
        }
        const outcome = await shareRealmCardData().then((shared) => shared, () => 'rejected' as const)
        expect(outcome).toBeNull()
        expect(h.errors).toEqual(['synthetic preflight failure'])
        expect(taskHostView()).toBeNull()
    })

    test('RL5 guard: a refused preflight returns null with the refusal notice and never shows a card', async () => {
        h.refuse = true
        const shared = await shareRealmCardData()
        expect(shared).toBeNull()
        expect(h.refusals).toEqual(['refuse-large'])
        expect(h.refusalCards).toEqual([null])
        expect(h.cards).toEqual([])
        expect(taskHostView()).toBeNull()
    })
})
