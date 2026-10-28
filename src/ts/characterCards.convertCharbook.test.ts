// @vitest-environment happy-dom

/**
 * `convertCharbook` in `src/ts/characterCards.ts` turns the lorebook of a
 * character card into RisuAI lore. The real exported function runs on synthetic
 * card entries and every case pins the whole converted entry, `extentions`
 * included. Reproducers fail before the card-path import-fidelity change;
 * guards pass before and after and say so.
 */

import { describe, expect, test, vi } from 'vitest'

//#region module mocks

vi.mock('uuid', () => ({ v4: () => 'uuid' }))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/upstreamAgreement'), () => ({
    askUpstreamAgreement: vi.fn(async () => true),
    isUpstreamAccepted: vi.fn(() => true),
    publishUpstreamAccepted: vi.fn(),
}) as unknown as typeof import('src/ts/upstreamAgreement'))

vi.mock(import('src/ts/alert'), () => ({
    alertCardExport: vi.fn(),
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertMd: vi.fn(),
    alertModuleSelect: vi.fn(),
    alertNormal: vi.fn(),
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    defaultSdDataFunc: vi.fn(() => ({})),
    setDatabase: vi.fn(),
    importPreset: vi.fn(),
    setCurrentCharacter: vi.fn(),
    getCurrentCharacter: vi.fn(),
    getCurrentChat: vi.fn(),
    getDatabase: vi.fn(() => ({ statics: { imports: 0 }, characters: [], modules: [], goCharacterOnImport: false })),
    setDatabaseLite: vi.fn(),
    appVer: 'test',
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/util'), () => ({
    asBuffer: (a: unknown) => a,
    Semaphore: class {},
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    checkPersonaBinded: vi.fn(),
    decryptBuffer: vi.fn(async (d: unknown) => d),
    isKnownUri: vi.fn(() => false),
    selectFileByDom: vi.fn(async () => null),
    selectSingleFile: vi.fn(async () => null),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

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
        saveAsset: vi.fn(async () => 'asset'),
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: unknown) => d),
    getImageType: vi.fn(() => 'png'),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return { characters: [], modules: [] } } },
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
    SeekMode: { Start: 0, Current: 1, End: 2 },
    readFile: vi.fn(async () => new Uint8Array()),
    open: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'windows' }))

vi.mock('@tauri-apps/plugin-deep-link', () => ({
    onOpenUrl: vi.fn(async () => vi.fn()),
}))

//#endregion

import { convertCharbook } from 'src/ts/characterCards'

type ConvertArg = Parameters<typeof convertCharbook>[0]
type CardEntry = ConvertArg['charbook']['entries'][number]

// A fresh card entry with the plain defaults; `over` replaces fields. The
// converter edits `extensions` in place, so no case shares an entry.
function cardEntry(over: Partial<CardEntry> = {}): CardEntry {
    return {
        keys: ['k'],
        content: 'X',
        extensions: {},
        enabled: true,
        insertion_order: 5,
        name: 'N',
        ...over,
    }
}

function convertOne(entry: CardEntry) {
    const result = convertCharbook({
        lorebook: [],
        charbook: { extensions: {}, entries: [entry] },
        loresettings: { tokenBudget: 1, scanDepth: 1, recursiveScanning: false, fullWordMatching: false },
        loreExt: undefined,
    })
    expect(result.lorebook).toHaveLength(1)
    return result.lorebook[0]
}

// The converted entry with the plain defaults; `over` replaces fields and
// `extentions` is the card extensions that stay on the entry.
function expected(over: Record<string, unknown> = {}, extentions: Record<string, unknown> = {}) {
    return {
        key: 'k',
        secondkey: '',
        insertorder: 5,
        comment: 'N',
        content: 'X',
        mode: 'normal',
        alwaysActive: false,
        selective: false,
        extentions: { ...extentions, risu_case_sensitive: undefined },
        loreCache: null,
        useRegex: false,
        ...over,
    }
}

describe('convertCharbook: enabled false imports inert', () => {
    test('reproducer: enabled false gets the dont_activate marker', () => {
        expect(convertOne(cardEntry({ enabled: false }))).toEqual(
            expected({ content: '@@dont_activate\nX' }))
    })

    test('reproducer: enabled false with its own @@activate keeps dont_activate as the last decorator', () => {
        expect(convertOne(cardEntry({ enabled: false, content: '@@activate\nX' }))).toEqual(
            expected({ content: '@@activate\n@@dont_activate\nX' }))
    })

    test('reproducer: enabled false goes after every migrated decorator', () => {
        expect(convertOne(cardEntry({
            enabled: false,
            extensions: { useProbability: true, probability: 40, position: 4, depth: 2, role: 1 },
        }))).toEqual(expected({ content: '@@reverse_depth 2\n@@role user\n@@probability 40\n@@dont_activate\nX' }))
    })

    test('guard (passes before and after): enabled true gets no marker', () => {
        expect(convertOne(cardEntry({ enabled: true }))).toEqual(expected())
    })

    test('guard (passes before and after): an entry without enabled gets no marker', () => {
        const { enabled: _omitted, ...withoutEnabled } = cardEntry()
        expect(convertOne(withoutEnabled as CardEntry)).toEqual(expected())
    })
})

describe('convertCharbook: position', () => {
    test('reproducer: extensions.position 1 writes @@position after_desc and drops the key', () => {
        expect(convertOne(cardEntry({ extensions: { position: 1, other: 'kept' } }))).toEqual(
            expected({ content: '@@position after_desc\nX' }, { other: 'kept' }))
    })

    test('reproducer: spec after_char with no extension position writes @@position after_desc', () => {
        expect(convertOne(cardEntry({ position: 'after_char' }))).toEqual(
            expected({ content: '@@position after_desc\nX' }))
    })

    test('reproducer: position 1 and spec after_char write one line', () => {
        expect(convertOne(cardEntry({ position: 'after_char', extensions: { position: 1 } }))).toEqual(
            expected({ content: '@@position after_desc\nX' }))
    })

    test('guard (passes before and after): spec before_char writes nothing', () => {
        expect(convertOne(cardEntry({ position: 'before_char' }))).toEqual(expected())
    })

    test('guard (passes before and after): extension positions 0 and 2 win over spec after_char and write nothing', () => {
        expect(convertOne(cardEntry({ position: 'after_char', extensions: { position: 0 } }))).toEqual(
            expected({}, { position: 0 }))
        expect(convertOne(cardEntry({ position: 'after_char', extensions: { position: 2 } }))).toEqual(
            expected({}, { position: 2 }))
    })

    test('guard (passes before and after): extension position 4 without a role writes nothing, even with spec after_char', () => {
        expect(convertOne(cardEntry({ position: 'after_char', extensions: { position: 4, depth: 2 } }))).toEqual(
            expected({}, { position: 4, depth: 2 }))
    })
})

describe('convertCharbook: depth', () => {
    test('reproducer: position 4 with depth 2 and role user writes @@reverse_depth', () => {
        expect(convertOne(cardEntry({ extensions: { position: 4, depth: 2, role: 1 } }))).toEqual(
            expected({ content: '@@reverse_depth 2\n@@role user\nX' }))
    })

    test('guard (passes before and after): position 4 with depth 0 writes @@depth 0', () => {
        expect(convertOne(cardEntry({ extensions: { position: 4, depth: 0, role: 1 } }))).toEqual(
            expected({ content: '@@depth 0\n@@role user\nX' }))
    })

    test('guard (passes before and after): position 4 with a negative depth keeps writing @@depth with that value', () => {
        expect(convertOne(cardEntry({ extensions: { position: 4, depth: -1, role: 0 } }))).toEqual(
            expected({ content: '@@depth -1\n@@role system\nX' }))
    })

    test('guard (passes before and after): position 4 without a role writes nothing and keeps its keys', () => {
        expect(convertOne(cardEntry({ extensions: { position: 4, depth: 2 } }))).toEqual(
            expected({}, { position: 4, depth: 2 }))
    })
})

describe('convertCharbook: other migrations stay as they are', () => {
    test('reproducer (depth line name only): the combined entry', () => {
        expect(convertOne(cardEntry({
            selective: true,
            secondary_keys: ['a'],
            extensions: { useProbability: true, probability: 40, position: 4, depth: 2, role: 1, selectiveLogic: 2 },
        }))).toEqual(expected({
            secondkey: 'a',
            content: '@@exclude_keys a\n@@reverse_depth 2\n@@role user\n@@probability 40\nX',
        }, { selectiveLogic: 2 }))
    })

    test('guard (passes before and after): logic 3 with two keys', () => {
        expect(convertOne(cardEntry({
            selective: true,
            secondary_keys: ['a', 'b'],
            extensions: { selectiveLogic: 3 },
        }))).toEqual(expected({
            secondkey: 'a, b',
            content: '@@additional_keys b\n@@additional_keys a\nX',
        }, { selectiveLogic: 3 }))
    })

    test('guard (passes before and after): logic 0 keeps selective true', () => {
        expect(convertOne(cardEntry({
            selective: true,
            secondary_keys: ['a'],
            extensions: { selectiveLogic: 0 },
        }))).toEqual(expected({ secondkey: 'a', selective: true }, { selectiveLogic: 0 }))
    })

    test('guard (passes before and after): useProbability 1 (truthy) with probability 40', () => {
        expect(convertOne(cardEntry({ extensions: { useProbability: 1, probability: 40 } }))).toEqual(
            expected({ content: '@@probability 40\nX' }))
    })
})
