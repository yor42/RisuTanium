// @vitest-environment happy-dom

/**
 * Output of the REAL `convertCharbook` (character-card lorebook entries) run
 * through the REAL `loadLoreBookV3Prompt`. Cases labelled "reproducer" are
 * red before the card-path import-fidelity change: the converted entry is
 * active or placed wrongly. Cases labelled "guard" pass before and after.
 * Every "inert" case would be active without the fix because the entry is
 * constant or force-activated.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    db: {
        characters: [] as unknown[],
        modules: [] as unknown[],
        username: 'User',
        loreBookDepth: 5,
        loreBookToken: 100000,
    },
}))

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
    getDatabase: vi.fn(() => h.db),
    setDatabaseLite: vi.fn(),
    appVer: 'test',
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/util'), () => ({
    asBuffer: (a: unknown) => a,
    Semaphore: class {},
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    checkPersonaBinded: vi.fn(),
    decryptBuffer: vi.fn(async (d: unknown) => d),
    findCharacterbyId: vi.fn(),
    isKnownUri: vi.fn(() => false),
    pickHashRand: vi.fn(() => 1),
    selectFileByDom: vi.fn(async () => null),
    selectSingleFile: vi.fn(async () => null),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characters'), () => ({
    changeChar: vi.fn(async () => {}),
    characterFormatUpdate: vi.fn((c: unknown) => c),
    createBlankChar: vi.fn(),
    getCharImage: vi.fn(),
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
    DBState: { db: h.db },
    HideIconStore: { set: vi.fn() },
    moduleBackgroundEmbedding: { set: vi.fn() },
    ReloadGUIPointer: { set: vi.fn() },
    SettingsMenuIndex: { set: vi.fn() },
    ShowRealmFrameStore: { set: vi.fn() },
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
    selectedCharID: { set: vi.fn(), subscribe(fn: (v: number) => void) { fn(0); return () => {} } },
    settingsOpen: { set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/parser/chatVar.svelte'), () => ({
    getChatVar: vi.fn(() => ''),
    setChatVar: vi.fn(),
}) as unknown as typeof import('src/ts/parser/chatVar.svelte'))

vi.mock(import('src/ts/tokenizer'), () => ({
    tokenize: vi.fn(async (text: string) => text.length),
}) as unknown as typeof import('src/ts/tokenizer'))

vi.mock(import('src/ts/process/modules'), () => ({
    getModuleLorebooks: vi.fn(() => []),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({
    markCharacterForSave: vi.fn(),
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

vi.mock(import('src/ts/process/memory/busyActions'), () => ({
    beginBusy: vi.fn(),
}) as unknown as typeof import('src/ts/process/memory/busyActions'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    reencodeImage: vi.fn(async (d: unknown) => d),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    decodeRPack: vi.fn(async (d: Uint8Array) => d),
    encodeRPack: vi.fn(async (d: Uint8Array) => d),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))

vi.mock(import('src/ts/interchangeability'), () => ({
    convertCharacterToModule: vi.fn(),
    convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))

vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({})) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: {} }))

vi.mock('@tauri-apps/plugin-fs', () => ({
    SeekMode: { Start: 0, Current: 1, End: 2 },
    readFile: vi.fn(async () => new Uint8Array()),
    open: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'windows' }))

vi.mock('@tauri-apps/plugin-deep-link', () => ({
    onOpenUrl: vi.fn(async () => vi.fn()),
}))

import { convertCharbook } from 'src/ts/characterCards'
import { loadLoreBookV3Prompt } from 'src/ts/process/lorebook.svelte'

type CardEntry = Parameters<typeof convertCharbook>[0]['charbook']['entries'][number]

// Converts the card entry with the real converter, then asks the real loader
// which entries the chat activates.
async function activesFor(over: Partial<CardEntry>, said: string) {
    const entry: CardEntry = { keys: ['zzz'], content: 'BODY', extensions: {}, enabled: true, insertion_order: 5, ...over }
    const converted = convertCharbook({
        lorebook: [],
        charbook: { extensions: {}, entries: [entry] },
        loresettings: { tokenBudget: 100000, scanDepth: 1, recursiveScanning: false, fullWordMatching: false },
        loreExt: undefined,
    })
    h.db.characters = [{
        name: 'Char',
        chatPage: 0,
        globalLore: converted.lorebook,
        loreSettings: { scanDepth: 1, tokenBudget: 100000, fullWordMatching: false, recursiveScanning: false },
        chats: [{ id: 'c', localLore: [], message: [{ role: 'user', data: said, time: 0 }] }],
    }]
    return (await loadLoreBookV3Prompt()).actives
}

beforeEach(() => {
    h.db.characters = []
})

describe('card entries in the loader', () => {
    test('reproducer: a constant entry with enabled false is not active', async () => {
        expect(await activesFor({ enabled: false, constant: true }, 'hi')).toHaveLength(0)
    })

    test('reproducer: an entry with enabled false and its own @@activate is not active', async () => {
        expect(await activesFor({ enabled: false, content: '@@activate\nBODY' }, 'hi')).toHaveLength(0)
    })

    test('reproducer: extensions.position 1 places the entry after the description', async () => {
        const actives = await activesFor({ constant: true, extensions: { position: 1 } }, 'hi')
        expect(actives).toHaveLength(1)
        expect(actives[0]).toMatchObject({ pos: 'after_desc', prompt: 'BODY' })
    })

    test('reproducer: spec after_char with no extension position places the entry after the description', async () => {
        const actives = await activesFor({ constant: true, position: 'after_char' }, 'hi')
        expect(actives).toHaveLength(1)
        expect(actives[0]).toMatchObject({ pos: 'after_desc', prompt: 'BODY' })
    })

    test('reproducer: position 4 with depth 2 is a reverse-depth entry at depth 2', async () => {
        const actives = await activesFor({ constant: true, extensions: { position: 4, depth: 2, role: 1 } }, 'hi')
        expect(actives).toHaveLength(1)
        expect(actives[0]).toMatchObject({ pos: 'reverse_depth', depth: 2, role: 'user', prompt: 'BODY' })
    })

    test('guard (passes before and after): an enabled entry with its key said is active and unplaced', async () => {
        const actives = await activesFor({}, 'zzz')
        expect(actives).toHaveLength(1)
        expect(actives[0]).toMatchObject({ pos: '', depth: 0, prompt: 'BODY' })
    })

    test('guard (passes before and after): position 4 with depth 0 is a depth entry at depth 0', async () => {
        const actives = await activesFor({ constant: true, extensions: { position: 4, depth: 0, role: 0 } }, 'hi')
        expect(actives).toHaveLength(1)
        expect(actives[0]).toMatchObject({ pos: 'depth', depth: 0, role: 'system', prompt: 'BODY' })
    })
})
