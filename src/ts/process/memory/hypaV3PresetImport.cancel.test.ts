// @vitest-environment happy-dom

/**
 * Closing the file chooser of the HypaV3 preset import without choosing a file
 * does nothing: no error toast, no message, no preset added. The function runs
 * over the REAL `selectSingleFile`; the chooser is played by
 * `util.domPickerHarness.ts`. A chosen preset file is added and announced.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { installDomPicker, settledWithin, type DomPicker } from 'src/ts/util.domPickerHarness'

const stores = vi.hoisted(() => ({
    db: { hypaV3Presets: [{ name: 'existing' }] as { name: string }[], hypaV3PresetId: 0 },
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

vi.mock(import('src/ts/process/memory/hypav3'), () => ({
    createHypaV3Preset: vi.fn((name: string) => ({ name })),
}) as unknown as typeof import('src/ts/process/memory/hypav3'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({ characters: [], allowAllExtentionFiles: false })),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/characters'), () => ({
    createBlankChar: vi.fn(),
    getCharImage: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))

vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({})) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: {} }))

import { importHypaV3PresetFile } from './hypaV3PresetImport'

let picker: DomPicker

beforeEach(() => {
    picker = installDomPicker()
    alerts.error.mockClear()
    alerts.normal.mockClear()
    stores.db.hypaV3Presets = [{ name: 'existing' }]
    stores.db.hypaV3PresetId = 0
})

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
        expect(stores.db.hypaV3Presets).toEqual([{ name: 'existing' }])
        expect(stores.db.hypaV3PresetId).toBe(0)
    })

    test('guard: a chosen preset export is added, selected and announced', async () => {
        const pending = importHypaV3PresetFile()

        picker.pick([new File([JSON.stringify({ type: 'risu', data: { name: 'Imported', settings: {} } })], 'p.json')])

        expect((await settledWithin(pending)).pending).toBe(false)
        expect(alerts.error).not.toHaveBeenCalled()
        expect(alerts.normal).toHaveBeenCalledTimes(1)
        expect(stores.db.hypaV3Presets.map((preset) => preset.name)).toEqual(['existing', 'Imported'])
        expect(stores.db.hypaV3PresetId).toBe(1)
    })

    test('guard: a file that is not a preset export is ignored quietly', async () => {
        const pending = importHypaV3PresetFile()

        picker.pick([new File([JSON.stringify({ type: 'other' })], 'x.json')])

        expect((await settledWithin(pending)).pending).toBe(false)
        expect(alerts.error).not.toHaveBeenCalled()
        expect(alerts.normal).not.toHaveBeenCalled()
        expect(stores.db.hypaV3Presets).toEqual([{ name: 'existing' }])
    })
})
