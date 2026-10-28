// @vitest-environment happy-dom

/**
 * `convertExternalLorebook` turns SillyTavern, NovelAI and Agnai world-info
 * entries into RisuAI lore. Every case pins the whole converted object.
 * Reproducers fail on the converter before the import-fidelity change; guards
 * pass before and after and say so.
 */
import { describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

vi.mock('../../stores.svelte', () => ({
    DBState: { db: {} },
    selectedCharID: writable(0),
}))
vi.mock('../../storage/database.svelte', () => ({ getDatabase: () => ({}) }))
vi.mock('../../alert', () => ({ alertError: vi.fn(), alertNormal: vi.fn() }))
vi.mock('../../../lang', () => ({ language: {} }))
vi.mock('../../globalApi.svelte', () => ({ downloadFile: vi.fn() }))
vi.mock('../../characters', () => ({ createBlankChar: vi.fn(), getCharImage: vi.fn() }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({})) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: {} }))
vi.mock('../../parser/chatVar.svelte', () => ({ getChatVar: vi.fn(), setChatVar: vi.fn() }))
vi.mock('../../parser/parser.svelte', () => ({ risuChatParser: vi.fn() }))
vi.mock('../../tokenizer', () => ({ tokenize: vi.fn() }))
vi.mock('../modules', () => ({ getModuleLorebooks: vi.fn(() => []) }))
vi.mock('../../storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn() }))
vi.mock('../memory/busyActions', () => ({ beginBusy: vi.fn() }))

import { convertExternalLorebook, type CCLorebook } from '../lorebook.svelte'

function convertOne(entry: Partial<CCLorebook>) {
    const out = convertExternalLorebook({ '0': entry as CCLorebook })
    expect(out).toHaveLength(1)
    return out[0]
}

// A converted entry with the plain defaults; `over` replaces fields.
function expected(over: Record<string, unknown> = {}) {
    return {
        key: 'k',
        insertorder: 0,
        comment: '',
        content: 'X',
        mode: 'normal',
        alwaysActive: false,
        secondkey: '',
        selective: false,
        ...over,
    }
}

describe('convertExternalLorebook: disabled entries import inert', () => {
    test('reproducer: SillyTavern disable true gets the dont_activate marker', () => {
        expect(convertOne({ key: ['k'], content: 'X', disable: true })).toEqual(
            expected({ content: '@@dont_activate\nX' }))
    })

    test('reproducer: SillyTavern disable true with its own @@activate keeps dont_activate as the last decorator', () => {
        expect(convertOne({ key: ['k'], content: '@@activate\nX', disable: true })).toEqual(
            expected({ content: '@@activate\n@@dont_activate\nX' }))
    })

    test('reproducer: NovelAI enabled false gets the dont_activate marker', () => {
        expect(convertOne({ keys: ['k'], text: 'X', displayName: 'N', forceActivation: false, enabled: false })).toEqual(
            expected({ comment: 'N', content: '@@dont_activate\nX' }))
    })

    test('reproducer: Agnai enabled false gets the dont_activate marker', () => {
        expect(convertOne({ keywords: ['k'], entry: 'X', name: 'A', priority: 3, enabled: false })).toEqual(
            expected({ comment: 'A', content: '@@dont_activate\nX', insertorder: 3 }))
    })

    test('guard (passes before and after): enabled true and disable false stay untouched', () => {
        expect(convertOne({ key: ['k'], content: 'X', disable: false, enabled: true })).toEqual(expected())
    })
})

describe('convertExternalLorebook: probability', () => {
    test('reproducer: useProbability with a probability other than 100 writes @@probability', () => {
        expect(convertOne({ key: ['k'], content: 'X', useProbability: true, probability: 40 })).toEqual(
            expected({ content: '@@probability 40\nX' }))
    })

    test('guard (passes before and after): probability 100 writes nothing', () => {
        expect(convertOne({ key: ['k'], content: 'X', useProbability: true, probability: 100 })).toEqual(expected())
    })

    test('guard (passes before and after): probability without useProbability writes nothing', () => {
        expect(convertOne({ key: ['k'], content: 'X', useProbability: false, probability: 40 })).toEqual(expected())
    })

    test('guard (passes before and after): a non-numeric probability writes nothing', () => {
        const entry = { key: ['k'], content: 'X', useProbability: true, probability: 'half' } as unknown as Partial<CCLorebook>
        expect(convertOne(entry)).toEqual(expected())
    })
})

describe('convertExternalLorebook: position and depth', () => {
    test('reproducer: position 1 writes @@position after_desc', () => {
        expect(convertOne({ key: ['k'], content: 'X', position: 1 })).toEqual(
            expected({ content: '@@position after_desc\nX' }))
    })

    test('reproducer: position 4 with depth 2 and role user writes @@reverse_depth and @@role', () => {
        expect(convertOne({ key: ['k'], content: 'X', position: 4, depth: 2, role: 1 })).toEqual(
            expected({ content: '@@reverse_depth 2\n@@role user\nX' }))
    })

    test('reproducer: position 4 with depth 0 and role system writes @@depth 0 and @@role', () => {
        expect(convertOne({ key: ['k'], content: 'X', position: 4, depth: 0, role: 0 })).toEqual(
            expected({ content: '@@depth 0\n@@role system\nX' }))
    })

    test('reproducer: position 4 with role assistant', () => {
        expect(convertOne({ key: ['k'], content: 'X', position: 4, depth: 3, role: 2 })).toEqual(
            expected({ content: '@@reverse_depth 3\n@@role assistant\nX' }))
    })

    test('reproducer: position 4 without a depth uses the default depth 4', () => {
        expect(convertOne({ key: ['k'], content: 'X', position: 4 })).toEqual(
            expected({ content: '@@reverse_depth 4\nX' }))
    })

    test('reproducer: position 4 with a negative depth writes @@depth with that value', () => {
        expect(convertOne({ key: ['k'], content: 'X', position: 4, depth: -1 })).toEqual(
            expected({ content: '@@depth -1\nX' }))
    })

    test('reproducer: position 4 with a role outside 0 to 2 writes the depth line and no role', () => {
        expect(convertOne({ key: ['k'], content: 'X', position: 4, depth: 2, role: 7 })).toEqual(
            expected({ content: '@@reverse_depth 2\nX' }))
    })

    test('guard (passes before and after): positions 0, 2, 3, 5, 6 and 7 write nothing', () => {
        for (const position of [0, 2, 3, 5, 6, 7]) {
            expect(convertOne({ key: ['k'], content: 'X', position, depth: 2, role: 1 })).toEqual(expected())
        }
    })

    test('guard (passes before and after): a string position is not read on the external path', () => {
        const entry = { key: ['k'], content: 'X', position: 'after_char' } as Partial<CCLorebook>
        expect(convertOne(entry)).toEqual(expected())
    })
})

describe('convertExternalLorebook: secondary keys', () => {
    test('reproducer: SillyTavern keysecondary with logic 0 fills secondkey and keeps selective', () => {
        expect(convertOne({ key: ['k'], content: 'X', keysecondary: ['a', 'b'], selective: true, selectiveLogic: 0 })).toEqual(
            expected({ secondkey: 'a, b', selective: true }))
    })

    test('reproducer: logic 1 (NOT_ALL) writes @@exclude_keys_all and clears selective', () => {
        expect(convertOne({ key: ['k'], content: 'X', keysecondary: ['a', 'b'], selective: true, selectiveLogic: 1 })).toEqual(
            expected({ secondkey: 'a, b', selective: false, content: '@@exclude_keys_all a,b\nX' }))
    })

    test('reproducer: logic 2 (NOT_ANY) writes one @@exclude_keys per key and clears selective', () => {
        expect(convertOne({ key: ['k'], content: 'X', keysecondary: ['a', 'b'], selective: true, selectiveLogic: 2 })).toEqual(
            expected({ secondkey: 'a, b', selective: false, content: '@@exclude_keys a\n@@exclude_keys b\nX' }))
    })

    test('reproducer: logic 3 (AND_ALL) writes one @@additional_keys per key and clears selective', () => {
        expect(convertOne({ key: ['k'], content: 'X', keysecondary: ['a', 'b'], selective: true, selectiveLogic: 3 })).toEqual(
            expected({ secondkey: 'a, b', selective: false, content: '@@additional_keys a\n@@additional_keys b\nX' }))
    })

    test('reproducer: selective false with logic 2 and keysecondary fills secondkey and writes no exclude line', () => {
        expect(convertOne({ key: ['k'], content: 'X', keysecondary: ['a', 'b'], selective: false, selectiveLogic: 2 })).toEqual(
            expected({ secondkey: 'a, b', selective: false }))
    })

    test('guard (passes before and after): selective false with logic 2 and secondary_keys writes no exclude line', () => {
        expect(convertOne({ key: ['k'], content: 'X', secondary_keys: ['a', 'b'], selective: false, selectiveLogic: 2 })).toEqual(
            expected({ secondkey: 'a, b', selective: false }))
    })

    test('guard (passes before and after): secondary_keys with logic 0 keep selective true', () => {
        expect(convertOne({ key: ['k'], content: 'X', secondary_keys: ['a'], selective: true, selectiveLogic: 0 })).toEqual(
            expected({ secondkey: 'a', selective: true }))
    })

    test('guard (passes before and after): logic 2 with no secondary keys writes no exclude line', () => {
        expect(convertOne({ key: ['k'], content: 'X', secondary_keys: [], selective: true, selectiveLogic: 2 })).toEqual(
            expected({ selective: true }))
    })
})

describe('convertExternalLorebook: combined and plain entries', () => {
    test('reproducer: a disabled entry with probability, position 1 and NOT_ANY keys keeps the marker last among the decorators', () => {
        expect(convertOne({
            key: ['k'], content: '@@activate\nX', disable: true, useProbability: true, probability: 40,
            position: 1, keysecondary: ['a'], selective: true, selectiveLogic: 2,
        })).toEqual(expected({
            secondkey: 'a',
            selective: false,
            content: '@@probability 40\n@@position after_desc\n@@exclude_keys a\n@@activate\n@@dont_activate\nX',
        }))
    })

    test('guard (passes before and after): an entry without the new fields converts as before', () => {
        expect(convertOne({ key: ['k'], content: 'X', constant: true, order: 5, comment: 'C', secondary_keys: ['s'], selective: true })).toEqual(
            expected({ insertorder: 5, comment: 'C', alwaysActive: true, secondkey: 's', selective: true }))
    })
})
