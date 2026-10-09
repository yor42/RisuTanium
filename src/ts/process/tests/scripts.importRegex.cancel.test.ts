// @vitest-environment happy-dom

/**
 * Closing the file chooser of the regex-script import without choosing a file
 * leaves the scripts as they were: the function resolves with the very array it
 * was given, and shows no error. Runs the REAL `importRegex` over the REAL
 * `selectSingleFile`; the chooser is played by `util.domPickerHarness.ts`.
 * Against a picker that answers `null` while the caller still dereferences the
 * result it rejects with a TypeError.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { installDomPicker, settledWithin, type DomPicker } from '../../util.domPickerHarness'
import type { customscript } from '../../storage/database.svelte'

const alerts = vi.hoisted(() => ({ error: vi.fn(), normal: vi.fn() }))

vi.mock('../../stores.svelte', () => ({
    CharEmotion: writable({}),
    selectedCharID: writable(0),
}))
vi.mock('../../storage/database.svelte', () => ({
    getDatabase: () => ({ characters: [], allowAllExtentionFiles: false }),
    getCurrentCharacter: () => ({ type: 'simple' }),
    getCurrentChat: () => ({}),
}))
vi.mock('../../globalApi.svelte', () => ({ downloadFile: vi.fn() }))
vi.mock('../../alert', () => ({ alertError: alerts.error, alertNormal: alerts.normal }))
vi.mock('src/lang', () => ({ language: { errors: { fileInvalidOrCorrupted: 'invalid' } } }))
vi.mock('../../characters', () => ({ createBlankChar: vi.fn(), getCharImage: vi.fn() }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({})) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: {} }))
vi.mock('../../parser/parser.svelte', () => ({
    assetRegex: /{{(raw|path|img|image|video|audio|bgm|bgmloop|emotion|asset|video-img|source)::(.+?)}}/g,
    risuChatParser: (data: string) => data,
}))
vi.mock('../modules', () => ({
    getModuleAssets: () => [],
    getModuleRegexScripts: () => [],
}))
vi.mock('../memory/hypamemory', () => ({ HypaProcesser: class {} }))
vi.mock('../scriptings', () => ({
    runLuaEditTrigger: async (_char: unknown, _mode: string, data: string) => data,
}))
vi.mock('../../plugins/plugins.svelte', () => ({ pluginV2: {} }))
vi.mock('../triggers', () => ({ runTrigger: vi.fn() }))
vi.mock('../chatOrigin', () => ({ createRunSubject: vi.fn() }))

import { importRegex } from '../scripts'

let picker: DomPicker

beforeEach(() => {
    picker = installDomPicker()
    alerts.error.mockClear()
    alerts.normal.mockClear()
})

afterEach(() => {
    picker.restore()
})

const existing = (): customscript[] => [{ comment: 'kept', in: 'a', out: 'b', type: 'editinput' } as customscript]

describe('importRegex', () => {
    test('closing the chooser resolves with the same array and shows no error', async () => {
        const scripts = existing()
        const pending = importRegex(scripts)

        picker.cancel()

        const result = await settledWithin(pending)
        expect(result.pending).toBe(false)
        expect(result.value).toBe(scripts)
        expect(scripts).toHaveLength(1)
        expect(alerts.error).not.toHaveBeenCalled()
    })

    test('guard: a chosen regex export is appended to the array', async () => {
        const scripts = existing()
        const pending = importRegex(scripts)

        picker.pick([new File([JSON.stringify({ type: 'regex', data: [{ comment: 'new', in: 'x', out: 'y', type: 'editinput' }] })], 'r.json')])

        const result = await settledWithin(pending)
        expect(result.pending).toBe(false)
        expect(scripts.map((script) => script.comment)).toEqual(['kept', 'new'])
    })
})
