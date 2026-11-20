// @vitest-environment happy-dom

/**
 * `importCharacter` (the file picker) in `src/ts/characterCards.ts` asks once before a multi-file pick starts: the file
 * count and the exact total size. Declining reads no file, bumps no import counter, writes no character and resolves to
 * an empty list; confirming imports every file as it always did; a single file shows no question.
 *
 * The real `characterCards.ts` runs on synthetic card files; everything around it is a recorder.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    errors: [] as string[],
    characters: [] as Array<Record<string, unknown>>,
    picked: null as File[] | null,
    statics: { imports: 0 },
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

vi.mock(import('src/ts/alert'), () => ({
    alertCardExport: vi.fn(),
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn((msg: string | Error) => { h.errors.push(msg instanceof Error ? msg.message : String(msg)) }),
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
    getDatabase: vi.fn(() => ({ statics: h.statics, characters: h.characters, modules: [], goCharacterOnImport: false })),
    setDatabaseLite: vi.fn(),
    appVer: 'test',
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/util'), () => ({
    asBuffer: (a: unknown) => a,
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    checkPersonaBinded: vi.fn(),
    decryptBuffer: vi.fn(async (d: unknown) => d),
    isKnownUri: vi.fn(() => false),
    selectFileByDom: vi.fn(async () => h.picked),
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

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'windows' }))

vi.mock('@tauri-apps/plugin-deep-link', () => ({
    onOpenUrl: vi.fn(async () => vi.fn()),
}))

import { importCharacter, importOpenedSources } from 'src/ts/characterCards'
import { answerTask, confirmTask, declineTask, resetTaskHostForTests, taskConfirmShowing, taskHostView, taskResultShowing } from 'src/ts/alertTask.svelte'
import { taskMiB } from 'src/lib/Nexus/pattern/taskProgress'
import { language } from 'src/lang'

const enc = new TextEncoder()

const v2Json = (name: string) => JSON.stringify({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: { name, description: 'd', personality: '', scenario: '', first_mes: 'hi', mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], tags: [], creator: '', character_version: '1', extensions: { risuai: {} } },
})

/** A card file, with every read of its content recorded in `reads`. */
function cardFile(name: string, reads: string[]): File {
    const file = new File([enc.encode(v2Json(name))], `${name}.json`, { type: 'application/json' })
    for (const method of ['arrayBuffer', 'text', 'stream', 'slice'] as const) {
        const original = file[method].bind(file) as (...args: never[]) => unknown
        Object.defineProperty(file, method, {
            value: (...args: never[]) => { reads.push(`${name}.${method}`); return original(...args) },
        })
    }
    return file
}

async function runUntil(done: Promise<unknown>, until: () => boolean) {
    let ended = false
    void done.then(() => { ended = true }, () => { ended = true })
    for (let i = 0; i < 400 && !ended && !until(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
}

const names = () => h.characters.map((c) => (c as { name?: string }).name)

beforeEach(() => {
    h.errors = []
    h.characters = []
    h.picked = null
    h.statics = { imports: 0 }
    h.uuid = 0
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
    resetTaskHostForTests()
    vi.restoreAllMocks()
})

describe('importCharacter preflight', () => {
    test('regression reproducer: a two-file pick asks once with the count and the exact total size before any file is read', async () => {
        const reads: string[] = []
        const a = cardFile('One', reads)
        const b = cardFile('Two', reads)
        h.picked = [a, b]
        const done = importCharacter()
        await runUntil(done, taskConfirmShowing)
        expect(taskConfirmShowing()).toBe(true)
        const confirm = taskHostView()?.confirm
        expect(confirm?.headline).toBe(language.importPreflightHeadline(2))
        expect(confirm?.consequences?.[0]).toBe(language.importPreflightSize(taskMiB(a.size + b.size)))
        expect(reads).toEqual([])
        expect(names()).toEqual([])

        confirmTask()
        await runUntil(done, taskResultShowing)
        answerTask({ kind: 'ok' })
        const slots = await done
        expect(names()).toEqual(['One', 'Two'])
        expect(slots).toHaveLength(2)
        expect(h.errors).toEqual([])
    })

    test('regression reproducer: declining reads no file, leaves the import counter alone, writes nothing and returns an empty list', async () => {
        const reads: string[] = []
        h.picked = [cardFile('One', reads), cardFile('Two', reads)]
        const done = importCharacter()
        await runUntil(done, taskConfirmShowing)
        expect(taskConfirmShowing()).toBe(true)
        declineTask()
        const slots = await done
        expect(slots).toEqual([])
        expect(reads).toEqual([])
        expect(h.statics.imports).toBe(0)
        expect(h.characters).toEqual([])
        expect(h.errors).toEqual([])
        expect(taskHostView()).toBeNull()
    })

    test('guard: files another app opened show no question, whatever their count (passes before and after; it kills a caller that turns the question on)', async () => {
        const done = importOpenedSources([
            { name: 'a.txt', path: 'content://one' },
            { name: 'b.txt', path: 'content://two' },
        ])
        await runUntil(done, () => taskConfirmShowing() || taskResultShowing())
        expect(taskConfirmShowing()).toBe(false)
        expect(taskResultShowing()).toBe(true)
        answerTask({ kind: 'ok' })
        await done
    })

    test('guard: a single file shows no question and imports (passes before and after)', async () => {
        h.picked = [cardFile('Solo', [])]
        const done = importCharacter()
        await runUntil(done, () => taskConfirmShowing() || taskResultShowing())
        expect(taskConfirmShowing()).toBe(false)
        if (taskResultShowing()) answerTask({ kind: 'ok' })
        await done
        expect(names()).toEqual(['Solo'])
    })
})
