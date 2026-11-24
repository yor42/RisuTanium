// @vitest-environment happy-dom
// Fixture producer (compatibility guard, passes before and after S7): the lorebook lists the classic producers write,
// run for real: `createBlankChar`, `addLorebook`, `addLorebookFolder` and `importLoreBook` over the real
// `selectSingleFile`, the chooser played by `util.domPickerHarness.ts`. The golden holds what they produced, so later
// Studio tests build their rows from real producer output (non-object rows, exact twins, a folder row with an id,
// wrong-kind field values that a classic import appends verbatim). Regenerate with `RISU_WRITE_LORE_GOLDEN=1`.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { installDomPicker, settledWithin, type DomPicker } from '../../../util.domPickerHarness'

const h = vi.hoisted(() => ({
    db: { characters: [] as unknown[], allowAllExtentionFiles: false },
    error: vi.fn(),
    nextId: 0,
}))

vi.mock('uuid', () => ({ v4: () => `00000000-0000-4000-8000-${String(++h.nextId).padStart(12, '0')}` }))
vi.mock('../../../stores.svelte', () => ({
    DBState: { db: h.db },
    selectedCharID: writable(0),
}))
vi.mock('../../../storage/database.svelte', () => ({
    getDatabase: () => h.db,
    defaultSdDataFunc: () => [],
}))
vi.mock('../../../alert', () => ({ alertError: h.error, alertNormal: vi.fn() }))
vi.mock('../../../../lang', () => ({ language: { errors: { noData: 'NO_DATA' } } }))
vi.mock('../../../globalApi.svelte', () => ({
    downloadFile: vi.fn(), readImage: vi.fn(), AppendableBuffer: class {}, changeChatTo: vi.fn(), checkCharOrder: vi.fn(),
    getFileSrc: vi.fn(), pickedAssetLimitBytes: vi.fn(), requiresFullEncoderReload: vi.fn(),
}))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({})) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: {} }))
vi.mock('../../../parser/chatVar.svelte', () => ({ getChatVar: vi.fn(), setChatVar: vi.fn() }))
vi.mock('../../../parser/parser.svelte', () => ({ risuChatParser: vi.fn() }))
vi.mock('../../../tokenizer', () => ({ tokenize: vi.fn() }))
vi.mock('../../../process/modules', () => ({ getModuleLorebooks: vi.fn(() => []) }))
vi.mock('../../../storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn() }))
vi.mock('../../../process/memory/busyActions', () => ({ beginBusy: vi.fn() }))

import { selectedCharID } from '../../../stores.svelte'
import { createBlankChar } from '../../../characters'
import { addLorebook, addLorebookFolder, importLoreBook } from '../../../process/lorebook.svelte'

const GOLDEN_PATH = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'loreClassic.golden.json')

interface Chatful { globalLore: unknown[]; chats: { localLore: unknown[] }[] }

let picker: DomPicker

function newChar(): Chatful {
    const character = createBlankChar() as unknown as Chatful
    h.db.characters.push(character)
    selectedCharID.set(h.db.characters.length - 1)
    return character
}

async function importRisu(mode: 'global' | 'local', data: unknown[]): Promise<void> {
    const pending = importLoreBook(mode)
    picker.pick([new File([JSON.stringify({ type: 'risu', data })], 'lore.json')])
    expect((await settledWithin(pending)).pending).toBe(false)
}

const entryA = { key: 'a', comment: 'A', content: 'alpha', mode: 'normal', insertorder: 100, alwaysActive: false, secondkey: '', selective: false, id: 'id-a' }
const entryB = { key: 'b', comment: 'B', content: 'beta', mode: 'normal', insertorder: 90, alwaysActive: true, secondkey: '', selective: false, extentions: { risu_case_sensitive: true } }
const twin = { key: 'twin', comment: 'Twin', content: 'same', mode: 'normal', insertorder: 100, alwaysActive: false, secondkey: '', selective: false }
const folderWithId = { key: 'folder:from-file', comment: 'Imported folder', content: '', mode: 'folder', insertorder: 100, alwaysActive: false, secondkey: '', selective: false, id: 'folder-id' }
// Classic import appends an entry verbatim, so a hand-edited export can carry values of another kind than the field's.
const wrongKind = { key: 'w', comment: 'Wrong kinds', content: null, mode: 'normal', insertorder: '100', alwaysActive: 'true', secondkey: '', selective: false }

async function runProducers(): Promise<Record<string, unknown>> {
    h.db.characters = []
    h.nextId = 0
    const out: Record<string, unknown> = {}

    const blank = newChar()
    addLorebook(0)
    addLorebook(1)
    addLorebookFolder(0)
    addLorebookFolder(1)
    out.blank = { globalLore: blank.globalLore, localLore: blank.chats[0].localLore }

    const mixed = newChar()
    await importRisu('global', [entryA, null, 'x', 5, [], entryB])
    out.mixedRows = { globalLore: mixed.globalLore }

    const twins = newChar()
    await importRisu('global', [twin])
    await importRisu('global', [twin])
    await importRisu('local', [twin])
    out.twins = { globalLore: twins.globalLore, localLore: twins.chats[0].localLore }

    const folders = newChar()
    await importRisu('global', [folderWithId, entryA])
    out.folderWithId = { globalLore: folders.globalLore }

    const wrong = newChar()
    await importRisu('global', [wrongKind])
    out.wrongKinds = { globalLore: wrong.globalLore }
    return JSON.parse(JSON.stringify(out))
}

beforeEach(() => {
    picker = installDomPicker()
    h.error.mockClear()
})

afterEach(() => {
    picker.restore()
})

describe('classic lorebook producers', () => {
    test('the golden holds what the real producers write', async () => {
        const actual = await runProducers()
        if (process.env.RISU_WRITE_LORE_GOLDEN === '1') {
            writeFileSync(GOLDEN_PATH, JSON.stringify(actual, null, 2) + '\n')
        }
        expect(h.error).not.toHaveBeenCalled()
        expect(actual).toEqual(JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')))
    })

    test('the producers keep what a classic import cannot reject: non-object rows, twins and wrong kinds', async () => {
        const actual = await runProducers() as {
            mixedRows: { globalLore: unknown[] }
            twins: { globalLore: unknown[] }
            wrongKinds: { globalLore: Record<string, unknown>[] }
        }
        expect(actual.mixedRows.globalLore).toEqual([entryA, null, 'x', 5, [], entryB])
        expect(actual.twins.globalLore).toEqual([twin, twin])
        expect(actual.wrongKinds.globalLore[0]).toMatchObject({ insertorder: '100', content: null, alwaysActive: 'true' })
    })
})
