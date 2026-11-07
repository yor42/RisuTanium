import { describe, expect, test } from 'vitest'
import { itemSectionsOf, moduleRowOf, workingPresetsOf, type CharacterText, type ItemTextOwner, type ItemTextSources } from './itemText'
import type { StudioItem, StudioKind } from './ownerModel'
import { residentModule, stubModule, watchBodyKeys } from './studioFixtures.test-helpers'

function item(kind: StudioKind, index = 0): StudioItem {
    return { id: `o/${kind}:${index}`, ownerKey: 'o', kind, index, name: '', folder: false }
}

function owner(type: ItemTextOwner['type'], id: string, overrides: Partial<ItemTextOwner> = {}): ItemTextOwner {
    return { type, id, restricted: false, stub: false, ...overrides }
}

function sources(character: Partial<CharacterText> = {}, rest: Partial<ItemTextSources> = {}): ItemTextSources {
    return { character: { chatPage: 0, ...character }, modules: [], presets: [], ...rest }
}

const texts = (list: ReturnType<typeof itemSectionsOf>) => (list ?? []).map((entry) => entry.text)

describe('character text per kind', () => {
    test('lore reads the content of the indexed entry', () => {
        const input = sources({ globalLore: [{ content: 'first' }, { content: 'second' }] })
        expect(texts(itemSectionsOf(owner('character', 'c'), item('lore', 1), input))).toEqual(['second'])
    })

    test('regex reads the pattern and the replacement', () => {
        const input = sources({ customscript: [{ in: 'a+', out: 'b' }] })
        expect(texts(itemSectionsOf(owner('character', 'c'), item('regex'), input))).toEqual(['a+\n→\nb'])
    })

    test('a Lua script reads as its code and any other list as its definition', () => {
        const lua = sources({ triggerscript: [{ effect: [{ type: 'triggerlua', code: 'lua-code' }] }] })
        expect(texts(itemSectionsOf(owner('character', 'c'), item('scripts'), lua))).toEqual(['lua-code'])
        const v2 = sources({ triggerscript: [{ effect: [{ type: 'v2Header' }] }] })
        expect(texts(itemSectionsOf(owner('character', 'c'), item('scripts'), v2))[0]).toContain('v2Header')
    })

    test('toggles, background HTML and the field kinds read their own text', () => {
        const input = sources({
            customModuleToggle: 'toggle-text', backgroundHTML: 'html-text', desc: 'desc-text', firstMessage: 'first-text',
            systemPrompt: 'system-text', scenario: 'scenario-text',
        })
        expect(texts(itemSectionsOf(owner('character', 'c'), item('toggles'), input))).toEqual(['toggle-text'])
        expect(texts(itemSectionsOf(owner('character', 'c'), item('html'), input))).toEqual(['html-text'])
        expect(itemSectionsOf(owner('character', 'c'), item('basic'), input)).toEqual([
            { field: 'description', text: 'desc-text' },
            { field: 'firstMessage', text: 'first-text' },
        ])
        expect(itemSectionsOf(owner('character', 'c'), item('advanced'), input)).toEqual([
            { field: 'systemPrompt', text: 'system-text' },
            { field: 'scenario', text: 'scenario-text' },
        ])
    })

    test('an item without text is readable and empty', () => {
        expect(itemSectionsOf(owner('character', 'c'), item('lore'), sources({ globalLore: [{}] }))).toEqual([])
        expect(itemSectionsOf(owner('character', 'c'), item('display'), sources())).toEqual([])
    })
})

describe('the private licence', () => {
    const secret = sources({
        license: 'private', globalLore: [{ content: 'secret' }], desc: 'secret', chats: [{ localLore: [{ content: 'secret' }] }],
    })

    test('character and chat content is withheld even when the owner is not flagged', () => {
        expect(itemSectionsOf(owner('character', 'c'), item('lore'), secret)).toBeNull()
        expect(itemSectionsOf(owner('character', 'c'), item('basic'), secret)).toBeNull()
        expect(itemSectionsOf(owner('chat', 'x'), item('lore'), secret)).toBeNull()
    })

    test('a restricted owner yields nothing', () => {
        const open = sources({ globalLore: [{ content: 'visible' }] })
        expect(itemSectionsOf(owner('character', 'c', { restricted: true }), item('lore'), open)).toBeNull()
    })
})

describe('chat, module and preset text', () => {
    test('the chat reads the lore of the context chat', () => {
        const input = sources({ chatPage: 1, chats: [{ localLore: [{ content: 'other' }] }, { localLore: [{ content: 'current' }] }] })
        expect(texts(itemSectionsOf(owner('chat', 'x'), item('lore'), input))).toEqual(['current'])
    })

    test('a resident module reads its own body', () => {
        const row = residentModule('res', { customModuleToggle: 'module-toggle', backgroundEmbedding: 'module-html' })
        const input = sources({}, { modules: [row] })
        expect(texts(itemSectionsOf(owner('module', 'res'), item('toggles'), input))).toEqual(['module-toggle'])
        expect(texts(itemSectionsOf(owner('module', 'res'), item('html'), input))).toEqual(['module-html'])
    })

    test('a duplicate module id is found by its row-suffixed owner id', () => {
        const first = residentModule('dup', { customModuleToggle: 'first' })
        const second = residentModule('dup', { customModuleToggle: 'second' })
        const input = sources({}, { modules: [first, second] })
        expect(texts(itemSectionsOf(owner('module', 'dup#1'), item('toggles'), input))).toEqual(['second'])
        expect(moduleRowOf('dup', [first, second])).toBe(first)
        expect(moduleRowOf('dup#0', [first, second])).toBe(first)
        expect(moduleRowOf('other#1', [first, second])).toBeUndefined()
    })

    test('a stub is never read: the owner flag and the row marker each stop it before any body key', () => {
        const reads: string[] = []
        const row = watchBodyKeys(stubModule('stub'), reads)
        const input = sources({}, { modules: [row] })
        expect(itemSectionsOf(owner('module', 'stub', { stub: true }), item('lore'), input)).toBeNull()
        expect(itemSectionsOf(owner('module', 'stub'), item('lore'), input)).toBeNull()
        expect(reads).toEqual([])
    })

    test('an owner the model marks not resident yields nothing even if a resident row carries its id', () => {
        const input = sources({}, { modules: [residentModule('res', { customModuleToggle: 'body' })] })
        expect(itemSectionsOf(owner('module', 'res', { stub: true }), item('toggles'), input)).toBeNull()
    })

    test('the active preset reads the working values, not the stored entry', () => {
        const presets = workingPresetsOf({
            botPresets: [
                { regex: [{ in: 'stored-0' }], customPromptTemplateToggle: 'stored-toggle-0' },
                { regex: [{ in: 'stored-1' }], customPromptTemplateToggle: 'stored-toggle-1' },
            ],
            botPresetsId: 1,
            presetRegex: [{ in: 'working' }],
            customPromptTemplateToggle: 'working-toggle',
        })
        const input = sources({}, { presets })
        expect(texts(itemSectionsOf(owner('preset', '1'), item('regex'), input))[0]).toContain('working')
        expect(texts(itemSectionsOf(owner('preset', '1'), item('toggles'), input))).toEqual(['working-toggle'])
        expect(texts(itemSectionsOf(owner('preset', '0'), item('toggles'), input))).toEqual(['stored-toggle-0'])
        expect(itemSectionsOf(owner('preset', '9'), item('toggles'), input)).toBeNull()
    })

    test('a plugin has no text', () => {
        expect(itemSectionsOf(owner('plugin', 'p'), item('plugin'), sources())).toEqual([])
    })
})
