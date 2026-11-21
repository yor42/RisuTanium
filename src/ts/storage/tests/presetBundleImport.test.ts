// @vitest-environment happy-dom

/**
 * Preset bundles through the REAL `importPreset` and `downloadPreset` of `src/ts/storage/database.svelte.ts`, with the
 * module mocks of `connectionsPresetTrust.test.ts` (cipher and rpack are identities here; `presetBundleCodec.test.ts`
 * covers the real cipher). The preview prompt is mocked at `askPrompt`; its component has its own tests.
 * The bundle reproducers fail against the named mutant of the finished stage. T-UNK is a regression reproducer on the
 * pre-change base: an unrecognised `.risup` type threw a TypeError. T-ORDER is a compatibility guard on the single path.
 * Keys and URLs are synthetic.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { encode as encodeMsgpack } from 'msgpackr/index-no-eval'
import * as fflate from 'fflate'

const prompt = vi.hoisted(() => ({
    answer: vi.fn(async (_data: { type: string }): Promise<string> => 'cancel'),
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/util'), () => ({
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    decryptBuffer: vi.fn(async (d: unknown) => d),
    encryptBuffer: vi.fn(async (d: unknown) => d),
    selectSingleFile: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(async () => true),
    saveAsset: vi.fn(async () => ''),
    forageStorage: {
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertNormal: vi.fn(),
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/alertPrompts'), () => ({
    askPrompt: vi.fn((data: { type: string }) => prompt.answer(data)),
}) as unknown as typeof import('src/ts/alertPrompts'))

vi.mock(import('src/ts/exportNotice'), () => ({
    downloadNotice: vi.fn((text: string) => text),
}) as unknown as typeof import('src/ts/exportNotice'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    defaultColorScheme: { bgcolor: '#000000' },
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/process/memory/hypav3'), () => ({
    createHypaV3Preset: vi.fn((name: string, settings: unknown) => ({ name, settings })),
}) as unknown as typeof import('src/ts/process/memory/hypav3'))

vi.mock(import('src/ts/translator/presets'), () => ({
    normalizeTranslatorPresetState: vi.fn(),
}) as unknown as typeof import('src/ts/translator/presets'))

vi.mock(import('src/ts/polyfill'), () => ({
    safeStructuredClone: vi.fn((v: unknown) => structuredClone(v)),
}) as unknown as typeof import('src/ts/polyfill'))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => {}),
    readFile: vi.fn(async () => new Uint8Array()),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} as unknown as Record<string, unknown> },
    selectedCharID: { subscribe: vi.fn(), set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/model/modellist'), async () => {
    const types = await import('src/ts/model/types')
    return {
        LLMFlags: types.LLMFlags,
        LLMFormat: types.LLMFormat,
        LLMTokenizer: types.LLMTokenizer,
    }
})

vi.mock('src/ts/rpack/rpack_js.js', () => ({
    encodeRPack: vi.fn(async (data: Uint8Array) => data),
    decodeRPack: vi.fn(async (data: Uint8Array) => data),
}))

import { DBState } from 'src/ts/stores.svelte'
import { importPreset, type StoredDatabase } from 'src/ts/storage/database.svelte'
import { buildPresetBundlePayload, PresetBundleError, type PresetBundlePayload } from 'src/ts/storage/presetBundle'
import { encodePresetBundle } from 'src/ts/storage/presetBundleFlow'
import type { botPreset } from 'src/ts/storage/database.svelte'
import { language } from 'src/lang'
import { missingSentinels, sentinelObject, sentinelsIn } from './shareStripFixture'

type Preset = Record<string, unknown> & { name?: string, id?: string, folderId?: string, slot?: number }
type Conn = { id: string, name: string, provider: string, key: string, url?: string }
type Page = { connections?: Conn[], botPresets: Preset[], presetFolders?: { id: string, name: string }[], botPresetsId: number } & Record<string, unknown>

function installPage(extra: Record<string, unknown> = {}): Page {
    const page = { characters: [], botPresets: [], botPresetsId: -1, ...extra } as unknown as Page
    ;(DBState as unknown as { db: StoredDatabase }).db = page as unknown as StoredDatabase
    return page
}

function bundleFile(entries: unknown[], name = 'b.risup'): Promise<{ name: string, data: Uint8Array }> {
    return encodePresetBundle({ format: 1, presets: entries } as unknown as PresetBundlePayload).then((data) => ({ name, data }))
}

function tickAll(count: number): void {
    prompt.answer.mockImplementation(async () => JSON.stringify(Array.from({ length: count }, (_, i) => i)))
}

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    prompt.answer.mockReset()
    prompt.answer.mockImplementation(async () => 'cancel')
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('a bundle through importPreset', () => {
    // reproducer vs M7 (folder never reused)
    test('T-RT: export, then import into a database with the folder and a taken name', async () => {
        const source = installPage({
            presetFolders: [{ id: 'src-rp', name: 'RP' }],
            botPresets: [
                { name: 'Alpha', id: 'a-id', folderId: 'src-rp', slot: 1 },
                { name: 'Beta', id: 'b-id', folderId: 'src-rp' },
                { name: 'Gamma', id: 'c-id' },
            ],
        })
        const file = {
            name: 'RP_presets.risup',
            data: await encodePresetBundle(buildPresetBundlePayload(source as never, source.botPresets as unknown as botPreset[])),
        }
        const target = installPage({ presetFolders: [{ id: 'f-rp', name: 'RP' }], botPresets: [{ name: 'Alpha', id: 'old' }] })
        tickAll(3)

        const result = await importPreset(file)

        expect(result).toBeUndefined()
        expect(prompt.answer).toHaveBeenCalledTimes(1)
        expect(target.botPresets.map((p) => p.name)).toEqual(['Alpha', 'Alpha (2)', 'Beta', 'Gamma'])
        expect(target.botPresets[0]).toMatchObject({ id: 'old' })
        const added = target.botPresets.slice(1)
        expect(added.map((p) => p.folderId)).toEqual(['f-rp', 'f-rp', undefined])
        expect(target.presetFolders).toEqual([{ id: 'f-rp', name: 'RP' }])
        for (const p of added) {
            expect(['a-id', 'b-id', 'c-id']).not.toContain(p.id)
            expect(typeof p.id).toBe('string')
            expect(Object.hasOwn(p, 'slot')).toBe(false)
        }
    })

    test('a folder the target lacks is created once for the presets that name it', async () => {
        const page = installPage()
        tickAll(2)
        await importPreset(await bundleFile([{ preset: { name: 'A' }, folder: 'New' }, { preset: { name: 'B' }, folder: 'New' }]))
        expect(page.presetFolders?.map((f) => f.name)).toEqual(['New'])
        expect(page.botPresets.map((p) => p.folderId)).toEqual([page.presetFolders?.[0].id, page.presetFolders?.[0].id])
    })

    test('the preview prompt gets the rows and the existing names', async () => {
        installPage({ botPresets: [{ name: 'Taken' }] })
        await importPreset(await bundleFile([{ preset: { name: 'A', aiModel: 'm1' }, folder: 'F' }, { preset: { name: 'B' } }]))
        expect(prompt.answer.mock.calls[0][0]).toMatchObject({
            type: 'presetBundle',
            presetBundle: { rows: [{ name: 'A', folder: 'F', aiModel: 'm1' }, { name: 'B', folder: null, aiModel: '' }], existingNames: ['Taken'] },
        })
    })

    test('only the ticked rows are added', async () => {
        const page = installPage()
        prompt.answer.mockImplementation(async () => '[1]')
        await importPreset(await bundleFile([{ preset: { name: 'A' } }, { preset: { name: 'B' } }]))
        expect(page.botPresets.map((p) => p.name)).toEqual(['B'])
    })

    test('the presets land in the database current after the answer, not the one at the preview', async () => {
        const first = installPage()
        const second = installPage()
        ;(DBState as unknown as { db: unknown }).db = first
        prompt.answer.mockImplementation(async () => {
            ;(DBState as unknown as { db: unknown }).db = second
            return '[0]'
        })
        await importPreset(await bundleFile([{ preset: { name: 'A' } }]))
        expect(first.botPresets).toEqual([])
        expect(second.botPresets.map((p) => p.name)).toEqual(['A'])
    })

    // reproducer vs M15 (commit ignores cancel)
    test.each(['cancel', '[]', '[7]', 'garbage'])('T-CANCEL: the answer %s imports nothing and reports a cancel', async (answer) => {
        const page = installPage({ presetFolders: [] })
        prompt.answer.mockImplementation(async () => answer)

        const result = await importPreset(await bundleFile([{ preset: { name: 'A' }, folder: 'F' }]))

        expect(result).toEqual({ cancelled: true })
        expect(page.botPresets).toEqual([])
        expect(page.presetFolders).toEqual([])
    })

    // reproducer vs M13 (validation during commit)
    test('T-ATOM: an invalid entry after valid ones refuses the whole bundle before the preview', async () => {
        const page = installPage({ presetFolders: [] })
        tickAll(3)

        const attempt = importPreset(await bundleFile([{ preset: { name: 'A' }, folder: 'F' }, { preset: { name: 'B' } }, { preset: [] }]))

        await expect(attempt).rejects.toBeInstanceOf(PresetBundleError)
        await expect(attempt).rejects.toThrow(language.errors.presetBundleInvalid)
        expect(prompt.answer).not.toHaveBeenCalled()
        expect(page.botPresets).toEqual([])
        expect(page.presetFolders).toEqual([])
    })

    test('a damaged bundle field is refused without a write', async () => {
        const page = installPage()
        const data = fflate.compressSync(encodeMsgpack({ presetVersion: 2, type: 'presetBundle', bundle: new Uint8Array([1, 2, 3]) }))
        await expect(importPreset({ name: 'x.risup', data })).rejects.toBeInstanceOf(PresetBundleError)
        expect(page.botPresets).toEqual([])
    })
})

describe('a bundle entry gets the single-import trust rule', () => {
    const crafted = () => ({
        name: 'Crafted',
        id: 'crafted-id',
        slot: 3,
        folderId: 'crafted-folder',
        proxyConnectionId: 'conn-1',
        forceReplaceUrl: 'https://attacker.invalid/v1',
        forceReplaceUrl2: 'https://attacker2.invalid/v1',
        textgenWebUIStreamURL: 'wss://attacker.invalid/s',
        textgenWebUIBlockingURL: 'https://attacker.invalid/b',
        koboldURL: 'https://attacker-kobold.invalid',
        openAIKey: 'sk-foreign',
        proxyKey: 'K-share',
    })
    const store = (): Conn[] => [{ id: 'conn-1', name: 'mine', provider: 'reverse_proxy', key: 'K-mine', url: 'https://mine.invalid/v1' }]

    async function viaSingle(): Promise<{ page: Page, preset: Preset }> {
        const page = installPage({ connections: store() })
        await importPreset({ name: 'shared.json', data: new TextEncoder().encode(JSON.stringify(crafted())) })
        return { page, preset: page.botPresets[0] }
    }

    // reproducer vs M3 (commit bypasses the intake); the individual blanking steps are pinned by connectionsPresetTrust
    test('T-BLANK: a crafted entry lands blanked and minted exactly as a single import would', async () => {
        const single = await viaSingle()
        const page = installPage({ connections: store() })
        tickAll(1)

        await importPreset(await bundleFile([{ preset: crafted() }]))

        const preset = page.botPresets[0]
        expect(page.botPresets).toHaveLength(1)
        expect(preset.proxyConnectionId).not.toBe('conn-1')
        expect(preset.proxyKey).toBe('')
        expect(preset.openAIKey).toBe('')
        expect(preset.forceReplaceUrl).toBe('')
        expect(preset.forceReplaceUrl2).toBe('')
        expect(preset.textgenWebUIStreamURL).toBe('')
        expect(preset.textgenWebUIBlockingURL).toBe('')
        expect(Object.hasOwn(preset, 'koboldURL')).toBe(false)
        expect(preset.id).not.toBe('crafted-id')
        expect(Object.hasOwn(preset, 'slot')).toBe(false)
        expect(Object.hasOwn(preset, 'folderId')).toBe(false)
        expect(page.connections).toHaveLength(2)
        expect(page.connections?.[1]).toMatchObject({ provider: 'reverse_proxy', key: 'K-share', url: '' })
        expect(preset.proxyConnectionId).toBe(page.connections?.[1].id)

        const drop = (p: Preset) => {
            const { id, proxyConnectionId, ...rest } = p
            return rest
        }
        expect(drop(preset)).toEqual(drop(single.preset))
    })

    // compatibility guard on the single path (passes before and after); kills M6 for the bundle path too
    test('T-ORDER: a whole-reference proxy key creates no connection, single or bundle', async () => {
        const reference = { name: 'Ref', proxyKey: ' ${RISU_Y_TOKEN} ' }
        const single = installPage({ connections: [] })
        await importPreset({ name: 'shared.json', data: new TextEncoder().encode(JSON.stringify(reference)) })
        expect(single.connections).toEqual([])
        expect(single.botPresets[0].proxyKey).toBe('')

        const page = installPage({ connections: [] })
        tickAll(1)
        await importPreset(await bundleFile([{ preset: reference }]))
        expect(page.connections).toEqual([])
        expect(page.botPresets[0].proxyKey).toBe('')
    })

    test('a bundle opened under the share-link name takes the same path', async () => {
        const page = installPage({ connections: store() })
        tickAll(1)
        const { data } = await bundleFile([{ preset: crafted() }])
        await importPreset({ name: 'imported.risupreset', data })
        expect(page.botPresets[0].openAIKey).toBe('')
        expect(page.botPresets[0].proxyConnectionId).not.toBe('conn-1')
    })
})

describe('an exported bundle carries no secret', () => {
    // reproducer vs M1 (strip skipped), through the real import
    test('T-STRIP: after the round trip no credential sentinel is on any imported preset', async () => {
        const { object, leaves } = sentinelObject('botPreset')
        const source = installPage({ botPresets: [{ ...structuredClone(object), name: 'S', koboldURL: 'https://sentinel-kobold.invalid', proxyConnectionId: 'conn-9' }] })
        expect(missingSentinels(source.botPresets[0], leaves)).toEqual([])
        const file = { name: 'x.risup', data: await encodePresetBundle(buildPresetBundlePayload(source as never, source.botPresets as unknown as botPreset[])) }
        const target = installPage({ connections: [] })
        tickAll(1)

        await importPreset(file)

        expect(sentinelsIn(target.botPresets[0], leaves)).toEqual([])
        expect(JSON.stringify(target.botPresets[0])).not.toContain('sentinel-kobold')
        expect(Object.hasOwn(target.botPresets[0], 'proxyConnectionId')).toBe(false)
        expect(target.connections).toEqual([])
    })
})

describe('an unrecognised .risup type', () => {
    const envelope = (extra: Record<string, unknown>) =>
        fflate.compressSync(encodeMsgpack({ presetVersion: 2, type: 'presetX', preset: new Uint8Array(encodeMsgpack({ name: 'X' })), ...extra }))

    // regression reproducer on the base: the TypeError at `pre.presetVersion`
    test('T-UNK: a clean refusal that names the file as unreadable, with nothing written', async () => {
        const page = installPage()

        const attempt = importPreset({ name: 'x.risup', data: envelope({}) })

        await expect(attempt).rejects.not.toBeInstanceOf(TypeError)
        await expect(attempt).rejects.toThrow(language.errors.presetFileUnknown)
        expect(page.botPresets).toEqual([])
    })

    test('a payload that is not an object is refused the same way', async () => {
        installPage()
        const data = fflate.compressSync(encodeMsgpack(7))
        await expect(importPreset({ name: 'x.risup', data })).rejects.toThrow(language.errors.presetFileUnknown)
    })

    test('a bundle envelope with another presetVersion is not a bundle', async () => {
        installPage()
        const data = envelope({ type: 'presetBundle', presetVersion: 1, bundle: new Uint8Array([1]) })
        await expect(importPreset({ name: 'x.risup', data })).rejects.toThrow(language.errors.presetFileUnknown)
    })
})
