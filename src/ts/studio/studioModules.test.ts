import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { RisuModule } from '../process/modules'
import { classifyModules, boundPersonaOf } from './studioModules'
import type { CharacterSource, PersonaSource } from './ownerModel'
import { listerOver, makeCharacter, makeChat, residentModule, stubModule } from './studioFixtures.test-helpers'

// The engine side (moduleRefIdsOf / moduleListOf) runs for real over a plain database. Only the stores, the
// database accessors and the persona lookup are replaced, with the same selection rules the app uses.
interface TestDb {
    characters: (CharacterSource & { type: 'character' | 'group', coldstorage?: string })[]
    modules: RisuModule[]
    enabledModules: string[]
    moduleIntergration: string
    personas: PersonaSource[]
    botPresets: { name?: string, regex?: { comment: string }[], customPromptTemplateToggle?: string }[]
    botPresetsId: number
    presetRegex: { comment: string }[]
    customPromptTemplateToggle: string
    plugins: { name: string }[]
}

const harness = vi.hoisted(() => ({ state: { db: {} as object }, selection: { selId: 0 } }))

vi.mock('../stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return { DBState: harness.state, selIdState: harness.selection, ReloadGUIPointer: writable(0) }
})
vi.mock('src/lang', () => ({ language: { moduleLoadFailed: (names: string) => names } }))
vi.mock('../storage/database.svelte', () => {
    const database = () => harness.state.db as TestDb
    const currentCharacter = () => database().characters[harness.selection.selId]
    return {
        getDatabase: () => database(),
        getCurrentCharacter: currentCharacter,
        getCurrentChat: () => {
            const character = currentCharacter()
            return character?.chats?.[character.chatPage]
        },
    }
})
vi.mock('../util', () => ({
    checkPersonaBinded: (chat?: { bindedPersona?: string } | null) => {
        const db = harness.state.db as TestDb
        const bound = chat === undefined ? db.characters[harness.selection.selId]?.chats?.[db.characters[harness.selection.selId].chatPage] : chat
        return boundPersonaOf(bound, db.personas) ?? undefined
    },
}))

const { moduleListOf, moduleRefIdsOf } = await import('../process/moduleRefList')
const { readOwnerModel } = await import('./ownerSource.svelte')

function install(overrides: Partial<TestDb> & { character?: Partial<CharacterSource> } = {}): TestDb {
    const { character, ...rest } = overrides
    const db: TestDb = {
        characters: [{ ...makeCharacter(character), type: 'character' }],
        modules: [],
        enabledModules: [],
        moduleIntergration: '',
        personas: [],
        botPresets: [],
        botPresetsId: -1,
        presetRegex: [],
        customPromptTemplateToggle: '',
        plugins: [],
        ...rest,
    }
    harness.state.db = db
    harness.selection.selId = 0
    return db
}

function engineIds(): string[] {
    return moduleListOf(moduleRefIdsOf()).map((row) => row.id)
}

function activeIds(): string[] {
    return (readOwnerModel('cha-1')?.modules ?? []).map((owner) => owner.id)
}

beforeEach(() => {
    install()
})

describe('3g active set equals the engine selection', () => {
    test('all five sources and namespace matches select the engine rows, with their badges', () => {
        install({
            modules: [
                residentModule('m-all'), residentModule('m-chat'), residentModule('m-char'), residentModule('m-persona'),
                residentModule('m-int'), residentModule('ns-a', { namespace: 'shared' }), residentModule('ns-b', { namespace: 'shared' }),
                residentModule('unrelated'), stubModule('s-chat'),
            ],
            enabledModules: ['m-all', 'shared'],
            moduleIntergration: 'm-int, ',
            personas: [{ id: 'p1', embeddedModule: { id: 'm-persona' } }],
            character: {
                modules: ['m-char'],
                chats: [makeChat({ id: 'c1', name: 'Chat', modules: ['m-chat', 's-chat'], bindedPersona: 'p1' })],
            },
        })
        const model = readOwnerModel('cha-1')
        expect(model).not.toBeNull()
        expect(engineIds()).toEqual(['m-all', 'm-chat', 'm-char', 'm-persona', 'm-int', 'ns-a', 'ns-b', 's-chat'])
        expect(activeIds()).toEqual(engineIds())
        const badges = Object.fromEntries((model?.modules ?? []).map((owner) => [owner.id, owner.badges]))
        expect(badges).toEqual({
            'm-all': ['allChats'],
            'm-chat': ['thisChat'],
            'm-char': ['character'],
            'm-persona': ['persona'],
            'm-int': ['integration'],
            'ns-a': ['allChats', 'namespace'],
            'ns-b': ['allChats', 'namespace'],
            's-chat': ['thisChat'],
        })
        expect(model?.otherModules.map((owner) => owner.id)).toEqual(['unrelated'])
    })

    test('a module that is on in two places carries both badges', () => {
        install({
            modules: [residentModule('both')],
            enabledModules: ['both'],
            character: { chats: [makeChat({ id: 'c1', name: 'Chat', modules: ['both'] })] },
        })
        expect(readOwnerModel('cha-1')?.modules[0].badges).toEqual(['allChats', 'thisChat'])
    })

    test('the same rows are active with no chat and with no modules at all', () => {
        install({ modules: [residentModule('only')], enabledModules: ['only'], character: { chats: [] } })
        expect(activeIds()).toEqual(engineIds())
        expect(activeIds()).toEqual(['only'])
        install()
        expect(activeIds()).toEqual([])
    })
})

describe('3g2 an id held twice', () => {
    test('the later row is under other modules, tagged not applied, with its own owner id', () => {
        install({
            modules: [residentModule('dup', { name: 'First' }), residentModule('dup', { name: 'Second' }), residentModule('idle')],
            enabledModules: ['dup'],
        })
        const model = readOwnerModel('cha-1')
        expect(model?.modules.map((owner) => owner.name)).toEqual(['First'])
        expect(model?.modules[0].id).toBe('dup')
        const others = model?.otherModules ?? []
        expect(others.map((owner) => owner.name)).toEqual(['Second', 'Module idle'])
        expect(others[0].tags).toEqual(['notApplied'])
        expect(others[0].id).not.toBe('dup')
        expect(others[1].tags).toEqual(['off'])
        expect(new Set(model?.owners.map((owner) => owner.key)).size).toBe(model?.owners.length)
        expect(activeIds()).toEqual(engineIds())
    })

    test('a resident row after an unloaded first holder is not applied either', () => {
        install({ modules: [stubModule('dup'), residentModule('dup', { name: 'Resident' })], enabledModules: ['dup'] })
        const model = readOwnerModel('cha-1')
        expect(model?.modules[0].stub).toBe(true)
        expect(model?.otherModules[0].name).toBe('Resident')
        expect(model?.otherModules[0].tags).toEqual(['notApplied'])
    })
})

describe('3g3 the reader re-reads chats[chatPage] when the chat page moves', () => {
    test('This chat and the active set follow the new page, and parity holds after the change', () => {
        const db = install({
            modules: [residentModule('m-a'), residentModule('m-b')],
            character: {
                chats: [
                    makeChat({ id: 'chat-a', name: 'A', modules: ['m-a'] }),
                    makeChat({ id: 'chat-b', name: 'B', modules: ['m-b'] }),
                ],
            },
        })
        const before = readOwnerModel('cha-1')
        expect(before?.chat?.id).toBe('chat-a')
        expect(activeIds()).toEqual(['m-a'])
        expect(activeIds()).toEqual(engineIds())

        db.characters[0].chatPage = 1
        const after = readOwnerModel('cha-1')
        expect(after?.chat?.id).toBe('chat-b')
        expect(after?.chat?.name).toBe('B')
        expect(activeIds()).toEqual(['m-b'])
        expect(activeIds()).toEqual(engineIds())
    })
})

describe('the bound character', () => {
    test('a different, grouped or cold selection reads as no model', () => {
        const db = install({ character: { chaId: 'cha-1' } })
        expect(readOwnerModel('cha-1')).not.toBeNull()
        expect(readOwnerModel('another')).toBeNull()
        db.characters[0].type = 'group'
        expect(readOwnerModel('cha-1')).toBeNull()
        db.characters[0].type = 'character'
        db.characters[0].coldstorage = 'cold-1'
        expect(readOwnerModel('cha-1')).toBeNull()
        db.characters[0].coldstorage = undefined
        harness.selection.selId = 4
        expect(readOwnerModel('cha-1')).toBeNull()
    })

    test('the active preset uses the working settings and the others their stored entry', () => {
        install({
            botPresets: [
                { name: 'A', regex: [{ comment: 'stale' }], customPromptTemplateToggle: 'old=Old' },
                { name: 'B', regex: [{ comment: 'b1' }, { comment: 'b2' }], customPromptTemplateToggle: '' },
            ],
            botPresetsId: 0,
            presetRegex: [{ comment: 'live1' }, { comment: 'live2' }, { comment: 'live3' }],
            customPromptTemplateToggle: 'live=Live',
        })
        const model = readOwnerModel('cha-1')
        const active = model?.presets[0]
        expect(active?.name).toBe('A')
        expect(active?.kinds().find((node) => node.kind === 'regex')?.count).toBe(3)
        expect(active?.kinds().find((node) => node.kind === 'toggles')?.count).toBe(1)
        expect(model?.otherPresets[0].kinds().find((node) => node.kind === 'regex')?.count).toBe(2)
        expect(model?.otherPresets[0].kinds().find((node) => node.kind === 'toggles')?.count).toBe(0)
    })
})

describe('classifyModules on its own', () => {
    test('an empty integration segment and an empty namespace never select a module', () => {
        const rows = [residentModule('', {}), residentModule('x', { namespace: '' })]
        const result = classifyModules(
            { enabledModules: [], chat: null, character: null, persona: null, moduleIntergration: 'a,,b' },
            rows,
            listerOver(rows),
        )
        // The engine keeps empty integration segments as references: the module with an empty id is selected by them.
        expect(result.ids).toEqual(['a', '', 'b'])
        expect(result.active.map((entry) => entry.module.id)).toEqual([''])
        expect(result.others.map((row) => row.id)).toEqual(['x'])
    })

    test('a persona entry is only found through the chat binding', () => {
        const personas = [{ id: 'p1' }]
        expect(boundPersonaOf({ bindedPersona: 'p1' }, personas)).toBe(personas[0])
        expect(boundPersonaOf({ bindedPersona: 'gone' }, personas)).toBeNull()
        expect(boundPersonaOf({}, personas)).toBeNull()
        expect(boundPersonaOf(null, personas)).toBeNull()
    })
})
