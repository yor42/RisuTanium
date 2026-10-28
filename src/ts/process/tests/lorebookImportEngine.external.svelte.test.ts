// @vitest-environment happy-dom

/**
 * Output of the REAL `convertExternalLorebook` (SillyTavern, NovelAI and Agnai
 * shapes) run through the REAL `loadLoreBookV3Prompt`. Reproducers are active
 * or placed wrongly on the converter before the import-fidelity change;
 * guards pass before and after. Every "inert" reproducer would be active
 * without the fix: it is constant, force-activated, or its key is said.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

const h = vi.hoisted(() => ({
    db: {
        characters: [] as unknown[],
        username: 'User',
        loreBookDepth: 5,
        loreBookToken: 100000,
    },
}))

vi.mock('../../stores.svelte', () => ({
    DBState: { db: h.db },
    selectedCharID: writable(0),
}))
vi.mock('../../storage/database.svelte', () => ({ getDatabase: () => h.db }))
vi.mock('../../alert', () => ({ alertError: vi.fn(), alertNormal: vi.fn() }))
vi.mock('../../../lang', () => ({ language: {} }))
vi.mock('../../globalApi.svelte', () => ({ downloadFile: vi.fn() }))
vi.mock('../../characters', () => ({ createBlankChar: vi.fn(), getCharImage: vi.fn() }))
vi.mock('../../util', () => ({ findCharacterbyId: vi.fn(), pickHashRand: vi.fn(() => 1), selectSingleFile: vi.fn() }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({})) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: {} }))
vi.mock('../../parser/chatVar.svelte', () => ({ getChatVar: vi.fn(() => ''), setChatVar: vi.fn() }))
vi.mock('../../parser/parser.svelte', () => ({ risuChatParser: vi.fn((text: string) => text) }))
vi.mock('../../tokenizer', () => ({ tokenize: vi.fn(async (text: string) => text.length) }))
vi.mock('../modules', () => ({ getModuleLorebooks: vi.fn(() => []) }))
vi.mock('../../storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn() }))
vi.mock('../memory/busyActions', () => ({ beginBusy: vi.fn() }))

import { convertExternalLorebook, loadLoreBookV3Prompt, type CCLorebook } from '../lorebook.svelte'

// Converts the entry, then asks the real loader which entries the chat activates.
async function activesFor(entry: Partial<CCLorebook>, said: string) {
    const lore = convertExternalLorebook({ '0': entry as CCLorebook })
    h.db.characters = [{
        name: 'Char',
        chatPage: 0,
        globalLore: lore,
        loreSettings: { scanDepth: 1, tokenBudget: 100000, fullWordMatching: false, recursiveScanning: false },
        chats: [{ id: 'c', localLore: [], message: [{ role: 'user', data: said, time: 0 }] }],
    }]
    return (await loadLoreBookV3Prompt()).actives
}

beforeEach(() => {
    h.db.characters = []
})

// The key 'zzz' is never said by 'hi', so only a force or constant activates these.
const disabledST = { key: ['zzz'], disable: true, selective: true, selectiveLogic: 0, position: 0, depth: 4, role: 0 }

describe('disabled entries are inert in the loader (SillyTavern source)', () => {
    test('reproducer: a disabled constant entry is not active', async () => {
        expect(await activesFor({ ...disabledST, constant: true, content: 'BODY' }, 'hi')).toHaveLength(0)
    })

    test('reproducer: a disabled entry with @@activate in its content is not active', async () => {
        expect(await activesFor({ ...disabledST, content: '@@activate\nBODY' }, 'hi')).toHaveLength(0)
    })

    test('reproducer: a disabled entry with a blank first line and then @@activate is not active', async () => {
        expect(await activesFor({ ...disabledST, content: '\n@@activate\nBODY' }, 'hi')).toHaveLength(0)
    })

    test('reproducer: a disabled entry with an indented @@activate is not active', async () => {
        expect(await activesFor({ ...disabledST, content: '  @@activate\nBODY' }, 'hi')).toHaveLength(0)
    })

    test('reproducer: a disabled entry with an invalid @@depth and a @@@activate fallback is not active', async () => {
        expect(await activesFor({ ...disabledST, content: '@@depth abc\n@@@activate\nBODY' }, 'hi')).toHaveLength(0)
    })

    test('reproducer: a disabled entry whose content is only decorators is not active', async () => {
        expect(await activesFor({ ...disabledST, content: '@@role user\n@@activate' }, 'hi')).toHaveLength(0)
    })

    test('reproducer: a disabled entry whose key is said is not active', async () => {
        expect(await activesFor({ ...disabledST, content: 'BODY' }, 'zzz')).toHaveLength(0)
    })

    test('reproducer: a NovelAI entry with enabled false and forceActivation is not active', async () => {
        expect(await activesFor({ keys: ['zzz'], text: 'BODY', forceActivation: true, enabled: false }, 'hi')).toHaveLength(0)
    })

    test('reproducer: an Agnai entry with enabled false whose keyword is said is not active', async () => {
        expect(await activesFor({ keywords: ['zzz'], entry: 'BODY', enabled: false }, 'zzz')).toHaveLength(0)
    })

    test('guard (passes before and after): an enabled entry with its key said is active', async () => {
        const actives = await activesFor({ key: ['zzz'], disable: false, content: 'BODY' }, 'zzz')
        expect(actives).toHaveLength(1)
        expect(actives[0].prompt).toBe('BODY')
    })

    test('guard (passes before and after): an enabled entry with its own @@dont_activate is inert, as in SillyTavern', async () => {
        expect(await activesFor({ key: ['zzz'], disable: false, content: '@@dont_activate\nBODY' }, 'zzz')).toHaveLength(0)
    })
})

describe('secondary-key logic in the loader (SillyTavern keysecondary)', () => {
    const andAny = { key: ['k1'], keysecondary: ['k2'], selective: true, selectiveLogic: 0, content: 'BODY' }

    test('reproducer: AND_ANY needs both keys', async () => {
        expect(await activesFor(andAny, 'k1')).toHaveLength(0)
        expect(await activesFor(andAny, 'k2')).toHaveLength(0)
        expect(await activesFor(andAny, 'k1 k2')).toHaveLength(1)
    })

    test('reproducer: NOT_ANY is excluded by its secondary key', async () => {
        const notAny = { key: ['k1'], keysecondary: ['k2'], selective: true, selectiveLogic: 2, content: 'BODY' }
        expect(await activesFor(notAny, 'k1')).toHaveLength(1)
        expect(await activesFor(notAny, 'k1 k2')).toHaveLength(0)
    })
})

describe('position and depth in the loader (SillyTavern source)', () => {
    const constant = { key: ['zzz'], constant: true, content: 'BODY' }

    test('reproducer: position 1 places the entry after the description', async () => {
        const actives = await activesFor({ ...constant, position: 1 }, 'hi')
        expect(actives).toHaveLength(1)
        expect(actives[0]).toMatchObject({ pos: 'after_desc', prompt: 'BODY' })
    })

    test('reproducer: position 4 with depth 2 is a reverse-depth entry at depth 2', async () => {
        const actives = await activesFor({ ...constant, position: 4, depth: 2, role: 0 }, 'hi')
        expect(actives).toHaveLength(1)
        expect(actives[0]).toMatchObject({ pos: 'reverse_depth', depth: 2, role: 'system', prompt: 'BODY' })
    })

    test('reproducer: position 4 with depth 0 is a depth entry at depth 0', async () => {
        const actives = await activesFor({ ...constant, position: 4, depth: 0, role: 1 }, 'hi')
        expect(actives).toHaveLength(1)
        expect(actives[0]).toMatchObject({ pos: 'depth', depth: 0, role: 'user', prompt: 'BODY' })
    })

    test('reproducer: position 4 with a negative depth reaches the loader as a depth entry with that value', async () => {
        const actives = await activesFor({ ...constant, position: 4, depth: -1 }, 'hi')
        expect(actives).toHaveLength(1)
        expect(actives[0]).toMatchObject({ pos: 'depth', depth: -1, prompt: 'BODY' })
    })

    test('guard (passes before and after): position 0 stays unplaced', async () => {
        const actives = await activesFor({ ...constant, position: 0 }, 'hi')
        expect(actives).toHaveLength(1)
        expect(actives[0]).toMatchObject({ pos: '', depth: 0, prompt: 'BODY' })
    })
})
