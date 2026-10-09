// @vitest-environment happy-dom

/**
 * Closing the file chooser of the persona image picker without choosing a file
 * does nothing: the function resolves, no busy indicator starts and the persona
 * is unchanged. Runs the REAL `selectUserImg` over the REAL `selectSingleFile`;
 * the chooser is played by `util.domPickerHarness.ts`. A picked image is saved.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { installDomPicker, settledWithin, type DomPicker } from './util.domPickerHarness'

const h = vi.hoisted(() => ({
    db: {
        userIcon: 'before',
        selectedPersona: 0,
        personas: [{ name: 'p' }] as Record<string, unknown>[],
        username: 'u',
        personaPrompt: '',
        userNote: '',
        allowAllExtentionFiles: false,
        characters: [],
    },
    begin: vi.fn(() => ({ end: vi.fn() })),
    save: vi.fn(async () => 'saved-image'),
}))

vi.mock('./storage/database.svelte', () => ({
    getDatabase: () => h.db,
    saveImage: h.save,
    setDatabase: vi.fn(),
}))
vi.mock('./stores.svelte', () => ({
    DBState: { db: h.db },
    selectedCharID: { subscribe: vi.fn() },
}))
vi.mock('./alert', () => ({ alertError: vi.fn(), alertNormal: vi.fn(), alertStore: { set: vi.fn() } }))
vi.mock('./globalApi.svelte', () => ({ AppendableBuffer: class {}, downloadFile: vi.fn(), readImage: vi.fn() }))
vi.mock('src/lang', () => ({ language: {} }))
vi.mock('./process/files/inlays', () => ({ reencodeImage: vi.fn() }))
vi.mock('./pngChunk', () => ({ PngChunk: class {} }))
vi.mock('./process/memory/busyActions', () => ({ beginBusy: h.begin }))
vi.mock('./characters', () => ({ createBlankChar: vi.fn(), getCharImage: vi.fn() }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({})) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: {} }))

import { selectUserImg } from './persona'

let picker: DomPicker

beforeEach(() => {
    picker = installDomPicker()
    h.begin.mockClear()
    h.save.mockClear()
    h.db.userIcon = 'before'
    h.db.personas = [{ name: 'p' }]
})

afterEach(() => {
    picker.restore()
})

describe('selectUserImg', () => {
    test('closing the chooser resolves, starts no busy indicator and changes nothing', async () => {
        const pending = selectUserImg()

        picker.cancel()

        expect((await settledWithin(pending)).pending).toBe(false)
        expect(h.begin).not.toHaveBeenCalled()
        expect(h.save).not.toHaveBeenCalled()
        expect(h.db.userIcon).toBe('before')
        expect(h.db.personas).toEqual([{ name: 'p' }])
    })

    test('guard: a chosen image is saved and becomes the persona icon', async () => {
        const pending = selectUserImg()

        picker.pick([new File([Uint8Array.of(1, 2, 3)], 'me.png')])

        expect((await settledWithin(pending)).pending).toBe(false)
        expect(h.save).toHaveBeenCalledTimes(1)
        expect(h.db.userIcon).toBe('saved-image')
    })
})
