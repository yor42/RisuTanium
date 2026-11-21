// @vitest-environment happy-dom

/**
 * The bundle envelope (`encodePresetBundle` / `decodePresetBundleEnvelope`) with the REAL `util.ts` legacy cipher, so
 * the bytes are what a `.risup` file holds. The rpack layer is the identity: it is its own format with its own tests.
 * The envelope assertions fail against the `presetVersion: 3` mutant (a NovelAI reading in `importPreset`).
 */
import { describe, expect, test, vi } from 'vitest'
import { decode as decodeMsgpack } from 'msgpackr/index-no-eval'
import * as fflate from 'fflate'

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/path', () => ({ basename: vi.fn(), appDataDir: vi.fn(), join: vi.fn() }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'windows' }))
vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 14 },
    readFile: vi.fn(async () => new Uint8Array()),
    open: vi.fn(),
    exists: vi.fn(),
    mkdir: vi.fn(),
    remove: vi.fn(),
    readDir: vi.fn(),
    rename: vi.fn(),
    writeFile: vi.fn(),
}))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({})),
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({ characters: [], allowAllExtentionFiles: false })),
    saveCurrentPreset: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: { subscribe: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/characters'), () => ({
    createBlankChar: vi.fn(),
    getCharImage: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertNormal: vi.fn(),
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/alertPrompts'), () => ({
    askPrompt: vi.fn(async () => 'cancel'),
}) as unknown as typeof import('src/ts/alertPrompts'))

vi.mock(import('src/ts/exportNotice'), () => ({
    downloadNotice: vi.fn((text: string) => text),
}) as unknown as typeof import('src/ts/exportNotice'))

vi.mock('src/ts/rpack/rpack_js.js', () => ({
    encodeRPack: vi.fn(async (data: Uint8Array) => data),
    decodeRPack: vi.fn(async (data: Uint8Array) => data),
}))

import { decryptBuffer } from 'src/ts/util'
import { bundleFileName, decodePresetBundleEnvelope, downloadPresetBundle, encodePresetBundle } from 'src/ts/storage/presetBundleFlow'
import { PRESET_BUNDLE_FORMAT, PresetBundleError, type PresetBundlePayload } from 'src/ts/storage/presetBundle'
import { getDatabase, saveCurrentPreset, type botPreset, type Database } from 'src/ts/storage/database.svelte'
import { downloadFile } from 'src/ts/globalApi.svelte'
import { alertNormal } from 'src/ts/alert'

const payload: PresetBundlePayload = {
    format: PRESET_BUNDLE_FORMAT,
    presets: [{ preset: { name: 'One' } as botPreset, folder: 'RP' }, { preset: { name: 'Two' } as botPreset }],
}

function unpack(bytes: Uint8Array): { presetVersion: number, type: string, bundle: Uint8Array, preset?: unknown } {
    return decodeMsgpack(fflate.decompressSync(bytes))
}

describe('the bundle envelope', () => {
    // reproducer vs M14 (presetVersion 3): the version assertion fails, and a version of 3 or more reads as NAI
    test('T-ENV: version 2, type presetBundle, payload under bundle, and the single-preset check rejects it', async () => {
        const decoded = unpack(await encodePresetBundle(payload))

        expect(decoded.presetVersion).toBe(2)
        expect(decoded.type).toBe('presetBundle')
        expect(Object.hasOwn(decoded, 'preset')).toBe(false)
        const singleCheck = (decoded.presetVersion === 0 || decoded.presetVersion === 2) && decoded.type === 'preset'
        expect(singleCheck).toBe(false)
        expect(decoded.presetVersion >= 3).toBe(false)
    })

    test('the payload is sealed with the legacy cipher keyed risupreset and round trips', async () => {
        const decoded = unpack(await encodePresetBundle(payload))

        const inner = decodeMsgpack(Buffer.from(await decryptBuffer(decoded.bundle, 'risupreset')))
        expect(inner).toEqual(payload)
        await expect(decryptBuffer(decoded.bundle, 'other-key')).rejects.toBeDefined()
        expect(await decodePresetBundleEnvelope(decoded)).toEqual(payload)
    })

    test('a missing, foreign or damaged bundle field is the invalid-bundle refusal', async () => {
        await expect(decodePresetBundleEnvelope({})).rejects.toBeInstanceOf(PresetBundleError)
        await expect(decodePresetBundleEnvelope({ bundle: 'text' })).rejects.toBeInstanceOf(PresetBundleError)
        await expect(decodePresetBundleEnvelope({ bundle: new Uint8Array([1, 2, 3, 4]) })).rejects.toBeInstanceOf(PresetBundleError)
    })
})

describe('bundleFileName', () => {
    const named = (...folders: (string | undefined)[]): PresetBundlePayload => ({
        format: PRESET_BUNDLE_FORMAT,
        presets: folders.map((folder) => ({ preset: { name: 'P' } as botPreset, ...(folder === undefined ? {} : { folder }) })),
    })

    test('the shared folder names the file; mixed or missing folders fall back to RisuTanium', () => {
        expect(bundleFileName(named('RP', 'RP'))).toBe('RP_presets.risup')
        expect(bundleFileName(named('RP', 'Other'))).toBe('RisuTanium_presets.risup')
        expect(bundleFileName(named('RP', undefined))).toBe('RisuTanium_presets.risup')
        expect(bundleFileName(named(undefined))).toBe('RisuTanium_presets.risup')
    })
})

describe('downloadPresetBundle', () => {
    const preset = (id: string, name: string, folderId?: string) => ({ id, name, ...(folderId === undefined ? {} : { folderId }) }) as unknown as botPreset
    const dbOf = (...presets: botPreset[]) => ({
        botPresets: presets,
        presetFolders: [{ id: 'f-rp', name: 'RP' }, { id: 'f-other', name: 'Other' }],
    }) as unknown as Database

    async function exportedPayload(): Promise<{ name: string, payload: PresetBundlePayload }> {
        const [name, bytes] = vi.mocked(downloadFile).mock.calls[0] as unknown as [string, Uint8Array]
        return { name, payload: await decodePresetBundleEnvelope(unpack(bytes)) as PresetBundlePayload }
    }

    test('exports only the ticked ids, in list order, after saving the current preset', async () => {
        vi.clearAllMocks()
        vi.mocked(getDatabase).mockReturnValue(dbOf(preset('a', 'A'), preset('b', 'B', 'f-rp'), preset('c', 'C')))

        await downloadPresetBundle(['c', 'a'])

        expect(saveCurrentPreset).toHaveBeenCalledTimes(1)
        expect(downloadFile).toHaveBeenCalledTimes(1)
        const { payload } = await exportedPayload()
        expect(payload.presets.map((entry) => entry.preset.name)).toEqual(['A', 'C'])
    })

    test('the file name is the shared folder, else RisuTanium', async () => {
        vi.clearAllMocks()
        vi.mocked(getDatabase).mockReturnValue(dbOf(preset('a', 'A', 'f-rp'), preset('b', 'B', 'f-rp'), preset('c', 'C', 'f-other')))

        await downloadPresetBundle(['a', 'b'])
        expect((await exportedPayload()).name).toBe('RP_presets.risup')

        vi.clearAllMocks()
        await downloadPresetBundle(['a', 'c'])
        expect((await exportedPayload()).name).toBe('RisuTanium_presets.risup')
    })

    test('the keys-left-out notice follows a successful save only', async () => {
        vi.clearAllMocks()
        vi.mocked(getDatabase).mockReturnValue(dbOf(preset('a', 'A')))

        await downloadPresetBundle(['a'])
        expect(alertNormal).toHaveBeenCalledTimes(1)

        vi.clearAllMocks()
        vi.mocked(downloadFile).mockResolvedValueOnce(false)
        await downloadPresetBundle(['a'])
        expect(downloadFile).toHaveBeenCalledTimes(1)
        expect(alertNormal).not.toHaveBeenCalled()
    })

    test('an empty selection or ids matching no preset writes nothing', async () => {
        vi.clearAllMocks()
        vi.mocked(getDatabase).mockReturnValue(dbOf(preset('a', 'A')))

        await downloadPresetBundle([])
        await downloadPresetBundle(['missing'])

        expect(downloadFile).not.toHaveBeenCalled()
        expect(alertNormal).not.toHaveBeenCalled()
    })
})
