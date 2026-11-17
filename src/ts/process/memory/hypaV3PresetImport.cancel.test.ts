// @vitest-environment happy-dom

/**
 * Closing the file chooser of the HypaV3 preset import without choosing a file
 * does nothing: no error toast, no message, no preset added. The function runs
 * over the REAL `selectSingleFile`; the chooser is played by
 * `util.domPickerHarness.ts`. A chosen preset file is added and announced; a
 * broken or foreign file is refused with an error and adds nothing; ratios in
 * the file are clamped to their valid shape; the file's own id is never used,
 * so the added preset gets a fresh id unique in the list.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { installDomPicker, settledWithin, type DomPicker } from 'src/ts/util.domPickerHarness'

const stores = vi.hoisted(() => ({
    db: { hypaV3Presets: [{ id: 'existing-id', name: 'existing' }] as { id: string, name: string }[], hypaV3PresetId: 0 },
}))
const alerts = vi.hoisted(() => ({ error: vi.fn(), normal: vi.fn() }))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: stores.db },
    selectedCharID: { subscribe: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: alerts.error,
    alertNormal: alerts.normal,
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({ characters: [], allowAllExtentionFiles: false })),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/characters'), () => ({
    createBlankChar: vi.fn(),
    getCharImage: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))

vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({})) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: {} }))

import { language } from 'src/lang'
import { importHypaV3PresetFile } from './hypaV3PresetImport'
import { hypaV3PresetFileOf, type HypaV3Preset } from './hypaV3Presets'

let picker: DomPicker

beforeEach(() => {
    picker = installDomPicker()
    alerts.error.mockClear()
    alerts.normal.mockClear()
    stores.db.hypaV3Presets = [{ id: 'existing-id', name: 'existing' }]
    stores.db.hypaV3PresetId = 0
})

async function importFile(text: string): Promise<void> {
    const pending = importHypaV3PresetFile()

    picker.pick([new File([text], 'p.json')])

    expect((await settledWithin(pending)).pending).toBe(false)
}

const stored = () => stores.db.hypaV3Presets as HypaV3Preset[]

afterEach(() => {
    picker.restore()
})

describe('importHypaV3PresetFile', () => {
    test('closing the chooser resolves without a toast and adds no preset', async () => {
        const pending = importHypaV3PresetFile()

        picker.cancel()

        expect((await settledWithin(pending)).pending).toBe(false)
        expect(alerts.error).not.toHaveBeenCalled()
        expect(alerts.normal).not.toHaveBeenCalled()
        expect(stores.db.hypaV3Presets).toEqual([{ id: 'existing-id', name: 'existing' }])
        expect(stores.db.hypaV3PresetId).toBe(0)
    })

    // The fixture carries one known settings key: a file without usable settings is refused as foreign.
    test('guard: a chosen preset export is added, selected and announced', async () => {
        await importFile(JSON.stringify({ type: 'risu', data: { name: 'Imported', settings: { memoryTokensRatio: 0.2 } } }))
        expect(alerts.error).not.toHaveBeenCalled()
        expect(alerts.normal).toHaveBeenCalledTimes(1)
        expect(stores.db.hypaV3Presets.map((preset) => preset.name)).toEqual(['existing', 'Imported'])
        expect(stores.db.hypaV3PresetId).toBe(1)
    })

    test('a file that is not a preset export is refused with the foreign message and adds nothing', async () => {
        await importFile(JSON.stringify({ type: 'other' }))

        expect(alerts.error).toHaveBeenCalledTimes(1)
        expect(alerts.error).toHaveBeenCalledWith(language.hypaV3Settings.presetImportForeignError)
        expect(alerts.normal).not.toHaveBeenCalled()
        expect(stores.db.hypaV3Presets).toEqual([{ id: 'existing-id', name: 'existing' }])
        expect(stores.db.hypaV3PresetId).toBe(0)
    })

    test('a preset export without usable settings is refused as foreign', async () => {
        await importFile(JSON.stringify({ type: 'risu', data: { name: 'NoSettings' } }))

        expect(alerts.error).toHaveBeenCalledWith(language.hypaV3Settings.presetImportForeignError)
        expect(alerts.normal).not.toHaveBeenCalled()
        expect(stored().map((preset) => preset.name)).toEqual(['existing'])
    })

    test('a file that does not parse is refused with the broken message, not the raw parser error', async () => {
        await importFile('{"type": "risu", ')

        expect(alerts.error).toHaveBeenCalledTimes(1)
        expect(alerts.error).toHaveBeenCalledWith(language.hypaV3Settings.presetImportBrokenError)
        expect(alerts.normal).not.toHaveBeenCalled()
        expect(stored().map((preset) => preset.name)).toEqual(['existing'])
    })

    test('imported ratios that overflow are clamped before the preset is stored', async () => {
        await importFile(JSON.stringify({
            type: 'risu',
            data: { name: 'Greedy', settings: { recentMemoryRatio: 0.9, similarMemoryRatio: 0.9, memoryTokensRatio: 0.9, extraSummarizationRatio: 0.5 } },
        }))

        const imported = stored()[1].settings
        expect(imported.recentMemoryRatio + imported.similarMemoryRatio).toBeLessThanOrEqual(1 + 1e-9)
        expect(imported.extraSummarizationRatio).toBeLessThanOrEqual(1 - imported.memoryTokensRatio + 1e-9)
    })

    test('the id in the file is ignored: the imported preset gets a fresh id, even one equal to an existing id', async () => {
        await importFile(JSON.stringify({
            type: 'risu',
            data: { id: 'existing-id', name: 'Clash', settings: { memoryTokensRatio: 0.3 } },
        }))

        const ids = stored().map((preset) => preset.id)
        expect(ids).toHaveLength(2)
        expect(ids[1]).toEqual(expect.any(String))
        expect(ids[1]).not.toBe('')
        expect(ids[1]).not.toBe('existing-id')
    })

    test('an exported preset file carries no id and imports back with the same settings', async () => {
        await importFile(JSON.stringify({ type: 'risu', data: { name: 'Round', settings: { maxChatsPerSummary: 9 } } }))
        const source = stored()[1]
        const file = hypaV3PresetFileOf(source)

        expect(Object.keys(file)).toEqual(['type', 'ver', 'data'])
        expect(Object.keys(file.data)).toEqual(['name', 'settings'])

        await importFile(JSON.stringify(file))
        const again = stored()[2]
        expect(again.settings).toEqual(source.settings)
        expect(again.id).not.toBe(source.id)
    })
})
