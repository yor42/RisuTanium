// @vitest-environment happy-dom

/**
 * `selectUserImg` changes the picture of one persona without changing its identity. The persona id
 * is what chat bindings and loadouts resolve, so a new id silently unbinds them. The target is
 * captured before the picker opens, so a selection change during the pick cannot redirect the icon.
 * Runs the REAL `selectUserImg` and `changeUserPersona` over the REAL `selectSingleFileObject`;
 * the chooser is played by `util.domPickerHarness.ts`.
 *
 * Titles beginning "regression reproducer:" fail against a version that writes a fresh id or that
 * reads the selection after the picker; "guard:" titles pass before and after.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { installDomPicker, settledWithin, type DomPicker } from './util.domPickerHarness'

interface TestPersona {
    name: string
    icon: string
    personaPrompt: string
    note: string
    id?: string
}

const h = vi.hoisted(() => ({
    db: {
        userIcon: '',
        selectedPersona: 0,
        personas: [] as Record<string, unknown>[],
        username: '',
        personaPrompt: '',
        userNote: '',
        allowAllExtentionFiles: false,
        characters: [],
    },
    begin: vi.fn(() => ({ end: vi.fn() })),
    save: vi.fn(async (_file: Blob) => 'saved-image'),
}))

vi.mock('./storage/database.svelte', () => ({
    getDatabase: () => h.db,
    saveImage: vi.fn(),
    setDatabase: vi.fn(),
}))
vi.mock('./stores.svelte', () => ({
    DBState: { db: h.db },
    selectedCharID: { subscribe: vi.fn() },
}))
vi.mock('./alert', () => ({ alertError: vi.fn(), alertNormal: vi.fn(), alertStore: { set: vi.fn() } }))
vi.mock('./globalApi.svelte', () => ({
    AppendableBuffer: class {},
    downloadFile: vi.fn(),
    readImage: vi.fn(),
    saveAssetFromBlob: h.save,
    pickedAssetLimitBytes: vi.fn(async () => 1024 * 1024),
}))
vi.mock('src/lang', () => ({ language: {} }))
vi.mock('./process/files/inlays', () => ({ reencodeImage: vi.fn() }))
vi.mock('./pngChunk', () => ({ PngChunk: class {} }))
vi.mock('./process/memory/busyActions', () => ({ beginBusy: h.begin }))
vi.mock('./characters', () => ({ createBlankChar: vi.fn(), getCharImage: vi.fn() }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({})) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: {} }))

import { changeUserPersona, selectUserImg } from './persona'

let picker: DomPicker

function seed(personas: TestPersona[], selected: number) {
    h.db.personas = personas.map((entry) => ({ ...entry }))
    h.db.selectedPersona = selected
    const active = personas[selected]
    h.db.username = active.name
    h.db.userIcon = active.icon
    h.db.personaPrompt = active.personaPrompt
    h.db.userNote = active.note
}

function entry(index: number): TestPersona {
    return h.db.personas[index] as unknown as TestPersona
}

async function pickFile() {
    const pending = selectUserImg()
    picker.pick([new File([Uint8Array.of(1, 2, 3)], 'me.png')])
    expect((await settledWithin(pending)).pending).toBe(false)
}

beforeEach(() => {
    picker = installDomPicker()
    h.begin.mockClear()
    h.save.mockClear()
})

afterEach(() => {
    picker.restore()
})

describe('selectUserImg identity', () => {
    test('regression reproducer: the persona keeps its id and gets the icon and the mirror', async () => {
        seed([{ name: 'A', icon: 'old', personaPrompt: 'P', note: 'N', id: 'keep' }], 0)

        await pickFile()

        expect(entry(0).id).toBe('keep')
        expect(entry(0).icon).toBe('saved-image')
        expect(h.db.userIcon).toBe('saved-image')
        expect(entry(0).name).toBe('A')
    })

    test('regression reproducer: an id recorded before the pick still resolves to the selected entry', async () => {
        seed([
            { name: 'X', icon: '', personaPrompt: '', note: '', id: 'x' },
            { name: 'A', icon: 'old', personaPrompt: 'P', note: 'N', id: 'recorded' },
        ], 1)
        const recordedId = entry(1).id

        await pickFile()

        expect(h.db.personas.findIndex((p) => (p as unknown as TestPersona).id === recordedId)).toBe(h.db.selectedPersona)
    })

    test('regression reproducer: a selection change during the pick leaves the new selection untouched', async () => {
        seed([
            { name: 'A', icon: 'old-a', personaPrompt: 'PA', note: 'NA', id: 'a' },
            { name: 'B', icon: 'icon-b', personaPrompt: 'PB', note: 'NB', id: 'b' },
        ], 0)

        const pending = selectUserImg()
        changeUserPersona(1)
        picker.pick([new File([Uint8Array.of(1, 2, 3)], 'me.png')])
        expect((await settledWithin(pending)).pending).toBe(false)

        expect(entry(0).icon).toBe('saved-image')
        expect(entry(0).id).toBe('a')
        expect(h.db.userIcon).toBe('icon-b')
        expect(entry(1).icon).toBe('icon-b')
        expect(entry(1).id).toBe('b')
        expect(h.db.selectedPersona).toBe(1)
    })

    test('guard: a persona without an id gets one after the pick', async () => {
        seed([{ name: 'A', icon: 'old', personaPrompt: 'P', note: 'N' }], 0)

        await pickFile()

        expect(typeof entry(0).id).toBe('string')
        expect(entry(0).id).not.toBe('')
        expect(entry(0).icon).toBe('saved-image')
    })
})
